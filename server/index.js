import express from "express";
import multer from "multer";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { z } from "zod";
import { config, publicConfig, saveConfig, dataDir, root } from "./config.js";
import {
  db,
  people,
  photos,
  trips,
  trip,
  updateTrip,
  searchPhotos,
} from "./store.js";
import { analyzePhoto, jsonFetch, apiUrl } from "./ai.js";
import {
  streetImage,
  getWeather,
  searchPlaces,
  validCoordinates,
  nearbyLocality,
  coordinateOnlyName,
} from "./location.js";
import { travelSchema, preparePlan, runTrip } from "./travel.js";
import { selectionUsesPhoto } from "./selection.js";
import { savePreview, confirmedPreview } from "./previews.js";
import { getEnvironment, environmentImage } from "./environment.js";
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  if (!["127.0.0.1", "localhost", "::1"].includes(req.hostname))
    return res.status(403).send("Local access only");
  next();
});
app.use(express.json({ limit: "100kb" }));
app.use("/api", (req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    try {
      const o = new URL(origin);
      if (
        !["127.0.0.1", "localhost", "[::1]"].includes(o.hostname) ||
        o.port !== String(config().port || 3210)
      )
        return res.status(403).json({ error: "拒绝跨站请求" });
    } catch {
      return res.status(403).json({ error: "请求来源无效" });
    }
  }
  res.set("Cache-Control", "no-store");
  next();
});
app.use(
  "/media",
  (req, res, next) => {
    if (!/^\/(photo|trip)-[a-f0-9-]+\.jpg$/.test(req.path))
      return res.sendStatus(404);
    res.set("X-Content-Type-Options", "nosniff");
    next();
  },
  express.static(dataDir, { dotfiles: "deny" }),
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 12 },
  fileFilter(req, file, cb) {
    cb(
      null,
      [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/heic",
        "image/heif",
      ].includes(file.mimetype),
    );
  },
});
const analysisQueue = [];
let analyzing = false;
async function drainAnalysis() {
  if (analyzing) return;
  analyzing = true;
  while (analysisQueue.length) {
    const id = analysisQueue.shift();
    const row = db
      .prepare(
        "SELECT f.*,p.name AS personName FROM photos f JOIN people p ON p.id=f.personId WHERE f.id=?",
      )
      .get(id);
    if (!row) continue;
    db.prepare(
      "UPDATE photos SET status='analyzing',error=NULL WHERE id=?",
    ).run(id);
    try {
      const analysis = await analyzePhoto(row);
      if (!db.prepare("SELECT id FROM photos WHERE id=?").get(id)) continue;
      db.exec("BEGIN");
      try {
        db.prepare(
          "UPDATE photos SET status='ready',analysis=? WHERE id=?",
        ).run(JSON.stringify(analysis), id);
        db.prepare("DELETE FROM photo_search WHERE photoId=?").run(id);
        db.prepare("INSERT INTO photo_search(photoId,text) VALUES (?,?)").run(
          id,
          [
            analysis.description,
            analysis.appearance,
            analysis.outfit,
            ...analysis.tags,
            ...analysis.style,
            ...analysis.colors,
          ].join(" "),
        );
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    } catch (e) {
      db.prepare("UPDATE photos SET status='failed',error=? WHERE id=?").run(
        e.message.slice(0, 500),
        id,
      );
    }
  }
  analyzing = false;
}
const tripQueue = [];
let generating = false;
async function drainTrips() {
  if (generating) return;
  generating = true;
  while (tripQueue.length) {
    const item = tripQueue.shift();
    await runTrip(item.id, item.request, item.plan);
  }
  generating = false;
}
db.prepare(
  "UPDATE trips SET status='failed',stage='生成已中断',error='服务重启使任务中断，请点击重试。' WHERE status IN ('queued','running')",
).run();
db.prepare("UPDATE photos SET status='queued' WHERE status='analyzing'").run();
analysisQueue.push(
  ...db
    .prepare("SELECT id FROM photos WHERE status='queued'")
    .all()
    .map((p) => p.id),
);
void drainAnalysis();
app.get("/api/state", (req, res) =>
  res.json({
    people: people(),
    photos: photos(),
    trips: trips(),
    settings: publicConfig(),
  }),
);
app.get("/api/settings", (req, res) => res.json(publicConfig()));
app.put("/api/settings", (req, res) => {
  const input = z
    .object({
      llm: z.object({
        baseUrl: z
          .string()
          .url()
          .refine((url) => ["http:", "https:"].includes(new URL(url).protocol)),
        apiKey: z.string().optional(),
        model: z.string().min(1),
        imageModel: z.string().min(1),
      }),
      google: z.object({ apiKey: z.string().optional() }),
      environment: z
        .object({ provider: z.enum(["commons", "google"]) })
        .optional(),
    })
    .parse(req.body);
  if (!input.llm.apiKey) delete input.llm.apiKey;
  if (input.google.apiKey === "") delete input.google.apiKey;
  saveConfig(input);
  res.json(publicConfig());
});
app.post("/api/settings/test", async (req, res) => {
  const c = config();
  const data = await jsonFetch(
    apiUrl("/models"),
    { headers: { Authorization: `Bearer ${c.llm.apiKey}` } },
    15000,
  );
  const ids = (data.data || []).map((m) => m.id);
  res.json({
    ok: true,
    llmAvailable: ids.includes(c.llm.model),
    imageAvailable: ids.includes(c.llm.imageModel),
    models: ids,
  });
});
app.post("/api/people", (req, res) => {
  const input = z
    .object({
      name: z.string().trim().min(1).max(40),
      note: z.string().max(400).default(""),
    })
    .parse(req.body);
  const id = randomUUID();
  db.prepare("INSERT INTO people(id,name,note,createdAt) VALUES (?,?,?,?)").run(
    id,
    input.name,
    input.note,
    new Date().toISOString(),
  );
  res.status(201).json(people().find((p) => p.id === id));
});
app.patch("/api/people/:id", (req, res) => {
  const input = z
    .object({
      name: z.string().trim().min(1).max(40),
      note: z.string().max(400).default(""),
    })
    .parse(req.body);
  const result = db
    .prepare("UPDATE people SET name=?,note=? WHERE id=?")
    .run(input.name, input.note, req.params.id);
  if (!result.changes) return res.status(404).json({ error: "人物不存在" });
  res.json({ ok: true });
});
function referencesBusy(photoId, personId) {
  return trips().some(
    (t) =>
      ["queued", "running"].includes(t.status) &&
      t.plan?.selected?.some(
        (p) => selectionUsesPhoto(p, photoId) || p.personId === personId,
      ),
  );
}
app.delete("/api/people/:id", async (req, res) => {
  if (referencesBusy(null, req.params.id))
    return res
      .status(409)
      .json({ error: "这个人物正在生成旅行照片，请完成后再删除。" });
  const rows = db
    .prepare("SELECT * FROM photos WHERE personId=?")
    .all(req.params.id);
  for (const row of rows) {
    db.prepare("DELETE FROM photo_search WHERE photoId=?").run(row.id);
  }
  db.prepare("DELETE FROM people WHERE id=?").run(req.params.id);
  await Promise.all(
    rows.map((row) => unlink(resolve(dataDir, row.filename)).catch(() => {})),
  );
  res.json({ ok: true });
});
app.post("/api/photos", upload.array("photos", 12), async (req, res) => {
  const input = z
    .object({ personId: z.string(), subject: z.string().max(400).default("") })
    .parse(req.body);
  if (!db.prepare("SELECT id FROM people WHERE id=?").get(input.personId))
    return res.status(400).json({ error: "请先选择照片所属人物。" });
  if (!req.files?.length)
    return res.status(400).json({ error: "请选择 JPG、PNG 或 WebP 照片。" });
  const created = [];
  const errors = [];
  for (const file of req.files) {
    const id = randomUUID();
    const filename = `photo-${id}.jpg`;
    try {
      await sharp(file.buffer, { limitInputPixels: 50000000 })
        .rotate()
        .resize({
          width: 1800,
          height: 1800,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 90 })
        .toFile(resolve(dataDir, filename));
      db.prepare(
        "INSERT INTO photos(id,personId,filename,originalName,subject,status,createdAt) VALUES (?,?,?,?,?,?,?)",
      ).run(
        id,
        input.personId,
        filename,
        file.originalname,
        input.subject,
        "queued",
        new Date().toISOString(),
      );
      created.push(id);
      analysisQueue.push(id);
    } catch {
      await unlink(resolve(dataDir, filename)).catch(() => {});
      errors.push(`${file.originalname} 无法读取，请换成 JPG、PNG 或 WebP。`);
    }
  }
  void drainAnalysis();
  res
    .status(created.length ? 201 : 400)
    .json(
      created.length ? { ids: created, errors } : { error: errors.join(" ") },
    );
});
app.post("/api/photos/:id/retry", (req, res) => {
  const row = db.prepare("SELECT * FROM photos WHERE id=?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "照片不存在" });
  if (["queued", "analyzing"].includes(row.status))
    return res.status(409).json({ error: "照片正在分析中。" });
  db.prepare("UPDATE photos SET status='queued',error=NULL WHERE id=?").run(
    row.id,
  );
  analysisQueue.push(row.id);
  void drainAnalysis();
  res.json({ ok: true });
});
app.delete("/api/photos/:id", async (req, res) => {
  const row = db.prepare("SELECT * FROM photos WHERE id=?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "照片不存在" });
  if (referencesBusy(row.id, null))
    return res
      .status(409)
      .json({ error: "这张照片正在用于生成，请完成后再删除。" });
  db.prepare("DELETE FROM photo_search WHERE photoId=?").run(row.id);
  db.prepare("DELETE FROM photos WHERE id=?").run(row.id);
  await unlink(resolve(dataDir, row.filename)).catch(() => {});
  res.json({ ok: true });
});
app.get("/api/photos/search", (req, res) => {
  const q = String(req.query.q || "")
    .trim()
    .slice(0, 200);
  if (!q) return res.json(photos());
  res.json(searchPhotos(q));
});
app.get("/api/locations/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2 || q.length > 200)
    return res.status(400).json({ error: "输入 2–200 字的地点名称。" });
  res.json(await searchPlaces(q));
});
app.get("/api/location", async (req, res) => {
  const lat = Number(req.query.lat),
    lng = Number(req.query.lng);
  if (!validCoordinates(lat, lng))
    return res.status(400).json({ error: "坐标无效" });
  const [weather, scene, locality] = await Promise.all([
    getWeather(lat, lng),
    getEnvironment({ lat, lng, name: String(req.query.name || "地图选点") }),
    coordinateOnlyName(String(req.query.name || ""))
      ? nearbyLocality(lat, lng)
      : null,
  ]);
  res.json({ weather, scene, locality });
});
app.get("/api/environment/photos/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0)
    return res.status(400).json({ error: "照片编号无效" });
  const bytes = await environmentImage(id);
  res
    .set("Cache-Control", "private, max-age=1800")
    .set("X-Content-Type-Options", "nosniff")
    .type("jpeg")
    .send(bytes);
});
app.get("/api/streetview", async (req, res) => {
  if (config().environment?.provider !== "google")
    return res
      .status(403)
      .json({ error: "Google 街景未启用，请先在设置中选择 Google 街景。" });
  const lat = Number(req.query.lat),
    lng = Number(req.query.lng),
    heading = Number(req.query.heading || 0);
  if (
    !validCoordinates(lat, lng) ||
    !Number.isFinite(heading) ||
    heading < 0 ||
    heading > 360
  )
    return res.status(400).json({ error: "坐标或朝向无效" });
  const bytes = await streetImage(lat, lng, heading);
  res.set("Cache-Control", "no-store").type("jpeg").send(bytes);
});
app.post("/api/travel/preview", async (req, res) => {
  const request = travelSchema.parse(req.body);
  res.json(savePreview(request, await preparePlan(request)));
});
app.post("/api/trips", async (req, res) => {
  const request = travelSchema.parse(req.body);
  let plan;
  if (request.previewToken) {
    try {
      plan = confirmedPreview(request);
    } catch (error) {
      return res.status(409).json({ error: error.message });
    }
  } else {
    plan = await preparePlan(request);
  }
  const id = randomUUID();
  db.prepare(
    "INSERT INTO trips(id,title,status,stage,request,plan,createdAt) VALUES (?,?,?,?,?,?,?)",
  ).run(
    id,
    request.location.name,
    "queued",
    "等待生成",
    JSON.stringify(request),
    JSON.stringify(plan),
    new Date().toISOString(),
  );
  tripQueue.push({ id, request, plan });
  void drainTrips();
  res
    .status(201)
    .json(trip(db.prepare("SELECT * FROM trips WHERE id=?").get(id)));
});
app.post("/api/trips/:id/retry", async (req, res) => {
  const row = db.prepare("SELECT * FROM trips WHERE id=?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "旅行不存在" });
  if (row.status !== "failed")
    return res.status(409).json({ error: "只能重试失败的任务。" });
  updateTrip(row.id, "正在准备重试", "queued", { error: null });
  try {
    const request = travelSchema.parse(JSON.parse(row.request));
    const plan = await preparePlan(request);
    updateTrip(row.id, "等待重试", "queued", { error: null, plan });
    tripQueue.push({ id: row.id, request, plan });
    void drainTrips();
    res.json({ ok: true });
  } catch (error) {
    updateTrip(row.id, "重试准备失败", "failed", { error: error.message });
    throw error;
  }
});
app.patch("/api/trips/:id", (req, res) => {
  const input = z.object({ favorite: z.boolean() }).parse(req.body);
  db.prepare("UPDATE trips SET favorite=? WHERE id=?").run(
    input.favorite ? 1 : 0,
    req.params.id,
  );
  res.json({ ok: true });
});
app.delete("/api/trips/:id", async (req, res) => {
  const row = db.prepare("SELECT * FROM trips WHERE id=?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "旅行不存在" });
  if (["running", "queued"].includes(row.status))
    return res.status(409).json({ error: "旅行正在生成中，请稍后删除。" });
  db.prepare("DELETE FROM trips WHERE id=?").run(row.id);
  if (row.filename)
    await unlink(resolve(dataDir, row.filename)).catch(() => {});
  res.json({ ok: true });
});
app.use("/api", (req, res) => res.status(404).json({ error: "接口不存在" }));
app.use((err, req, res, next) => {
  if (err instanceof z.ZodError)
    return res.status(400).json({
      error: err.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("；"),
    });
  res.status(err instanceof multer.MulterError ? 400 : 500).json({
    error:
      err.code === "LIMIT_FILE_SIZE"
        ? "单张照片不能超过 20MB。"
        : err.message || "请求失败",
  });
});
if (process.env.NODE_ENV !== "production") {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(resolve(root, "dist")));
  app.get("/{*path}", (req, res) =>
    res.sendFile(resolve(root, "dist/index.html")),
  );
}
const port = config().port || 3210;
app.listen(port, "127.0.0.1", (error) => {
  if (error) {
    console.error(`VirtualTrip 启动失败：${error.message}`);
    process.exit(1);
  }
  console.log(`VirtualTrip ready at http://127.0.0.1:${port}`);
});
