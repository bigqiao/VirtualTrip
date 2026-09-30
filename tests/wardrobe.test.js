import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chooseReference,
  clothingCandidates,
  clothingGuidance,
} from "../server/selection.js";
const dir = await mkdtemp(join(tmpdir(), "virtualtrip-wardrobe-"));
process.env.VIRTUALTRIP_DATA_DIR = dir;
process.env.VIRTUALTRIP_CONFIG = join(dir, "config.json");
await writeFile(
  process.env.VIRTUALTRIP_CONFIG,
  JSON.stringify({
    llm: { model: "test", baseUrl: "http://mock.test/v1" },
    google: { apiKey: "" },
  }),
);
const { matchWardrobes } = await import("../server/wardrobe.js");
const { db } = await import("../server/store.js");
const { savePreview, confirmedPreview } = await import("../server/previews.js");
const make = (id, outfit, min, max, quality = 0.72) => ({
  id,
  analysis: {
    hasPerson: true,
    outfit,
    temperatureMin: min,
    temperatureMax: max,
    identityQuality: quality,
    style: ["休闲"],
    tags: [],
  },
});
const vest = make("vest", "卡其外套、救生衣、牛仔裤", 8, 20);
const coat = make("coat", "机能外套、牛仔裤、户外鞋", 10, 22);
const casual = make("casual", "短袖与长裤", 15, 25, 0.55);
const summer = make("summer", "无袖上衣与宽腿牛仔裤", 23, 34, 0.95);
const context = (name, temperature = 16, instruction = "") => ({
  location: { lat: 0, lng: 0, name },
  temperature,
  weather: { temperature },
  style: "daily",
  moment: "natural",
  instruction,
});
const person = (photos = [vest, coat, casual, summer], override = {}) => ({
  id: "alice",
  photos,
  override,
  note: "",
  recentOutfitIds: ["coat"],
});
const model = (pick) => async (prompt, images, schema, timeout) => {
  assert.deepEqual(images, []);
  assert.equal(timeout, 30000);
  const payload = JSON.parse(prompt.split("CONTEXT_JSON:")[1]);
  return schema.parse({
    selections: payload.people.map((p) => ({
      personId: p.personId,
      photoId: pick(payload, p),
      reason: "所选衣着适合目的地的活动与天气",
    })),
  });
};
test("life jacket is excluded for canyon, Italian city and American city even with the clearest face", () => {
  for (const name of ["大峡谷天空步道", "意大利罗马街角", "美国纽约中央公园"]) {
    const c = context(name, 14.8);
    assert.deepEqual(
      clothingCandidates([vest, coat], c.temperature, c).map((p) => p.id),
      ["coat"],
    );
    for (const photos of [
      [vest, coat],
      [coat, vest],
    ])
      assert.equal(chooseReference(photos, c).photo.id, "coat");
  }
});
test("activity equipment becomes available only for the matching activity; manual choices still win", () => {
  assert.ok(
    clothingCandidates(
      [vest, coat],
      16,
      context("河边", 16, "体验皮划艇"),
    ).some((p) => p.id === "vest"),
  );
  assert.equal(
    chooseReference([vest, coat], {
      ...context("罗马"),
      overridePhotoId: "vest",
    }).photo.id,
    "vest",
  );
  assert.equal(
    chooseReference([vest, coat], {
      ...context("罗马"),
      overrideOutfit: "一定穿救生衣",
    }).manual,
    true,
  );
});
test("weather fit has higher weight than face clarity and upload order for wardrobe fallback", () => {
  const broad = make("clear-face", "轻薄衣着", 0, 30, 0.99);
  const specific = make("comfortable", "长袖衣着", 12, 20, 0.45);
  for (const photos of [
    [broad, specific],
    [specific, broad],
  ])
    assert.equal(
      chooseReference(photos, context("城市", 16)).photo.id,
      "comfortable",
    );
});
test("polar destination adapts clothes and explicitly requires expedition protection", () => {
  const chosen = chooseReference([vest, coat, summer], context("南极点", -56));
  assert.equal(chosen.adapt, true);
  assert.equal(chosen.photo.id, "summer");
  assert.match(chosen.reason, /仅参考外貌/);
  assert.match(clothingGuidance(-56), /expedition-grade/);
});
test("real matching contract gives the model destination, eligible indexed outfits and recent wardrobe IDs", async () => {
  let calls = 0;
  const select = model((payload, p) => {
    calls++;
    assert.ok(
      !p.candidates.some((c) => ["vest", "summer"].includes(c.photoId)),
    );
    assert.deepEqual(p.recentOutfitIds, ["coat"]);
    return payload.location.name.includes("罗马") ? "casual" : "coat";
  });
  const italy = (
    await matchWardrobes([person()], context("意大利罗马测试选衣"), { select })
  )[0];
  const canyon = (
    await matchWardrobes([person()], context("美国大峡谷测试选衣"), { select })
  )[0];
  assert.equal(italy.chosen.photo.id, "casual");
  assert.equal(canyon.chosen.photo.id, "coat");
  assert.equal(italy.chosen.selectionMethod, "llm");
  assert.equal(calls, 2);
});
test("model cannot bypass temperature and special equipment exclusions with a returned ID", async () => {
  for (const id of ["vest", "summer", "nonexistent"]) {
    const result = (
      await matchWardrobes([person()], context(`无效模型选择${id}`), {
        select: model(() => id),
      })
    )[0];
    assert.equal(result.chosen.selectionMethod, "fallback");
    assert.equal(result.chosen.photo.id, "coat");
    assert.match(result.chosen.reason, /AI 场景匹配暂不可用/);
  }
});
test("model failures and incomplete participant selections safely use rule matching", async () => {
  for (const [name, select] of [
    [
      "error",
      async () => {
        throw new Error("offline");
      },
    ],
    ["incomplete", async () => ({ selections: [] })],
  ]) {
    const results = await matchWardrobes(
      [person(), { ...person(), id: "bob" }],
      context(name),
      { select },
    );
    assert.ok(
      results.every(
        (p) =>
          p.chosen.selectionMethod === "fallback" &&
          p.chosen.photo.id === "coat",
      ),
    );
  }
});
test("manual, no-clothing and unknown-weather choices do not request model reranking", async () => {
  let calls = 0;
  const select = async () => {
    calls++;
    throw new Error("should not be called");
  };
  const manual = await matchWardrobes(
    [person(undefined, { photoId: "vest" })],
    context("南极手动", -40),
    { select },
  );
  assert.equal(manual[0].chosen.manual, true);
  const polar = await matchWardrobes([person()], context("南极自动", -40), {
    select,
  });
  assert.equal(polar[0].chosen.adapt, true);
  const unknown = await matchWardrobes([person()], context("未知天气", null), {
    select,
  });
  assert.equal(unknown[0].chosen.adapt, true);
  assert.equal(calls, 0);
});
test("concurrent identical previews share a model request without forcing changes to a suitable outfit", async () => {
  let calls = 0;
  const select = model(() => {
    calls++;
    return "coat";
  });
  const results = await Promise.all(
    Array.from({ length: 3 }, () =>
      matchWardrobes([person()], context("一致预览"), { select }),
    ),
  );
  assert.equal(calls, 1);
  assert.ok(results.every((r) => r[0].chosen.photo.id === "coat"));
});
db.prepare("INSERT INTO people(id,name,createdAt) VALUES (?,?,?)").run(
  "alice",
  "测试人物",
  "2026-09-30",
);
for (const p of [coat, casual])
  db.prepare(
    "INSERT INTO photos(id,personId,filename,originalName,status,analysis,createdAt) VALUES (?,?,?,?,?,?,?)",
  ).run(
    p.id,
    "alice",
    `photo-${p.id}.jpg`,
    `${p.id}.jpg`,
    "ready",
    JSON.stringify(p.analysis),
    "2026-09-30",
  );
const request = {
  location: { name: "测试地点", lat: 0, lng: 0 },
  personIds: ["alice"],
  outfits: {},
  temperature: 16,
};
const plan = {
  selected: [
    {
      personId: "alice",
      photoId: "coat",
      adapt: false,
      references: [{ photoId: "coat" }, { photoId: "casual" }],
    },
  ],
  temperature: 16,
};
test("generation uses the reviewed preview and returns an isolated copy", () => {
  const saved = savePreview(request, plan);
  saved.selected[0].photoId = "client-edited";
  const req = { ...request, previewToken: saved.previewToken };
  const confirmed = confirmedPreview(req);
  assert.equal(confirmed.selected[0].photoId, "coat");
  confirmed.selected[0].photoId = "mutated";
  assert.equal(confirmedPreview(req).selected[0].photoId, "coat");
});
test("changed travel options and unknown preview tokens cannot generate an old selection", () => {
  const saved = savePreview(request, plan);
  assert.throws(
    () =>
      confirmedPreview({
        ...request,
        temperature: 25,
        previewToken: saved.previewToken,
      }),
    /选项已变化/,
  );
  assert.throws(
    () => confirmedPreview({ ...request, previewToken: "unknown" }),
    /预览已过期/,
  );
});
test("changing the environment requires a new preview and preserves the newly reviewed image", () => {
  const original = { ...request, environmentPhotoId: 101 };
  const originalPlan = {
    ...plan,
    scene: { source: "commons", photo: { id: 101 } },
  };
  const saved = savePreview(original, originalPlan);
  assert.equal(
    confirmedPreview({ ...original, previewToken: saved.previewToken }).scene
      .photo.id,
    101,
  );
  const changed = { ...original, environmentPhotoId: 102 };
  assert.throws(
    () => confirmedPreview({ ...changed, previewToken: saved.previewToken }),
    /选项已变化/,
  );
  const updated = savePreview(changed, {
    ...originalPlan,
    scene: { source: "commons", photo: { id: 102 } },
  });
  assert.equal(
    confirmedPreview({ ...changed, previewToken: updated.previewToken }).scene
      .photo.id,
    102,
  );
});
test("changing camera style invalidates a previously reviewed plan", () => {
  const original = { ...request, style: "daily" };
  const saved = savePreview(original, plan);
  assert.throws(
    () =>
      confirmedPreview({
        ...original,
        style: "drone",
        previewToken: saved.previewToken,
      }),
    /选项已变化/,
  );
});
test("deleted supplementary image invalidates the preview before any generation", () => {
  const saved = savePreview(request, plan);
  db.prepare("DELETE FROM photos WHERE id=?").run("casual");
  assert.throws(
    () => confirmedPreview({ ...request, previewToken: saved.previewToken }),
    /参考照片已变动/,
  );
});
test.after(async () => {
  db.close();
  await rm(dir, { recursive: true, force: true });
});
