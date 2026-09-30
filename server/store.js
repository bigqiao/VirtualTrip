import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { dataDir } from "./config.js";
export const db = new DatabaseSync(resolve(dataDir, "virtualtrip.sqlite"));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS people(id TEXT PRIMARY KEY, name TEXT NOT NULL, note TEXT DEFAULT '', createdAt TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY, personId TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE, filename TEXT NOT NULL, originalName TEXT NOT NULL, subject TEXT DEFAULT '', status TEXT NOT NULL, analysis TEXT, error TEXT, createdAt TEXT NOT NULL);
 CREATE VIRTUAL TABLE IF NOT EXISTS photo_search USING fts5(photoId UNINDEXED, text, tokenize='trigram');
 CREATE TABLE IF NOT EXISTS trips(id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, stage TEXT NOT NULL, request TEXT NOT NULL, plan TEXT, filename TEXT, error TEXT, favorite INTEGER DEFAULT 0, createdAt TEXT NOT NULL);
`);
const parse = (v) => (v ? JSON.parse(v) : null);
export function people() {
  return db
    .prepare(
      `SELECT p.*, COUNT(f.id) AS photoCount, SUM(CASE WHEN f.status='ready' AND json_extract(f.analysis,'$.hasPerson')=1 THEN 1 ELSE 0 END) AS readyCount, (SELECT filename FROM photos WHERE personId=p.id ORDER BY status='ready' DESC, createdAt ASC LIMIT 1) AS avatar FROM people p LEFT JOIN photos f ON f.personId=p.id GROUP BY p.id ORDER BY p.createdAt`,
    )
    .all()
    .map((p) => ({
      ...p,
      readyCount: p.readyCount || 0,
      avatar: p.avatar ? `/media/${p.avatar}` : null,
    }));
}
export function photo(row) {
  return row
    ? { ...row, analysis: parse(row.analysis), url: `/media/${row.filename}` }
    : null;
}
export function photos() {
  return db
    .prepare(
      "SELECT f.*, p.name AS personName FROM photos f JOIN people p ON p.id=f.personId ORDER BY f.createdAt DESC",
    )
    .all()
    .map(photo);
}
export function trip(row) {
  return row
    ? {
        ...row,
        request: parse(row.request),
        plan: parse(row.plan),
        url: row.filename ? `/media/${row.filename}` : null,
        favorite: !!row.favorite,
      }
    : null;
}
export function trips() {
  return db
    .prepare("SELECT * FROM trips ORDER BY createdAt DESC")
    .all()
    .map(trip);
}
export function updateTrip(id, stage, status = "running", extra = {}) {
  const fields = { stage, status, ...extra };
  const entries = Object.entries(fields);
  db.prepare(
    `UPDATE trips SET ${entries.map(([k]) => `${k}=?`).join(",")} WHERE id=?`,
  ).run(
    ...entries.map(([, v]) => (typeof v === "object" ? JSON.stringify(v) : v)),
    id,
  );
}

export function searchPhotos(query) {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return photos();
  const longTokens = tokens.filter((t) => [...t].length >= 3);
  const indexed = new Map(
    longTokens.map((t) => [
      t,
      new Set(
        db
          .prepare(
            "SELECT photoId FROM photo_search WHERE photo_search MATCH ?",
          )
          .all('"' + t.replaceAll('"', '""') + '"')
          .map((row) => row.photoId),
      ),
    ]),
  );
  return photos().filter((p) => {
    const names = [p.personName, p.originalName].join(" ").toLowerCase();
    const text = [
      names,
      p.analysis?.description,
      p.analysis?.appearance,
      p.analysis?.outfit,
      ...(p.analysis?.tags || []),
      ...(p.analysis?.style || []),
      ...(p.analysis?.colors || []),
    ]
      .join(" ")
      .toLowerCase();
    return tokens.every(
      (t) =>
        text.includes(t.toLowerCase()) &&
        (!indexed.has(t) ||
          indexed.get(t).has(p.id) ||
          names.includes(t.toLowerCase())),
    );
  });
}
