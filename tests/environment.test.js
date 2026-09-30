import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
const dir = await mkdtemp(join(tmpdir(), "virtualtrip-environment-"));
process.env.VIRTUALTRIP_DATA_DIR = dir;
process.env.VIRTUALTRIP_CONFIG = join(dir, "config.json");
await writeFile(
  process.env.VIRTUALTRIP_CONFIG,
  JSON.stringify({
    llm: { baseUrl: "http://mock.test/v1", model: "test" },
    google: { apiKey: "test-key" },
  }),
);
const {
  commonsPhoto,
  nearbyPhotos,
  getEnvironment,
  chooseEnvironment,
  environmentImage,
} = await import("../server/environment.js");
const fixture = await sharp({
  create: { width: 800, height: 600, channels: 3, background: "#b8d8e8" },
})
  .jpeg()
  .toBuffer();
const page = (id, title = "Local street.jpg", extra = {}) => ({
  pageid: id,
  title: `File:${title}`,
  coordinates: [{ lat: 41.9028, lon: 12.4964 }],
  imageinfo: [
    {
      mime: "image/jpeg",
      width: 1800,
      height: 1200,
      url: `https://upload.wikimedia.org/test/${id}.jpg`,
      thumburl: `https://upload.wikimedia.org/thumb/${id}.jpg`,
      descriptionurl: `https://commons.wikimedia.org/wiki/File:Street_${id}.jpg`,
      extmetadata: {
        LicenseShortName: { value: "CC BY-SA 4.0" },
        LicenseUrl: {
          value: "https://creativecommons.org/licenses/by-sa/4.0/",
        },
        Artist: {
          value: '<a href="https://example.com">Photographer &amp; friends</a>',
        },
        ImageDescription: { value: "Local architecture and room for walkers" },
        DateTimeOriginal: { value: "2018-01-02" },
      },
    },
  ],
  ...extra,
});
const realFetch = globalThis.fetch;
let queryCount = 0,
  imageCount = 0,
  googleCount = 0,
  mode = "normal";
globalThis.fetch = async (url) => {
  const address = String(url);
  if (address.includes("maps.googleapis.com")) {
    googleCount++;
    throw new Error("Google must not be requested");
  }
  if (address.includes("commons.wikimedia.org/w/api.php")) {
    queryCount++;
    const u = new URL(url);
    if (mode === "error") throw new Error("offline");
    const pages =
      mode === "empty" ||
      (mode === "expanded" && u.searchParams.get("ggsradius") === "3000")
        ? []
        : [page(101), page(102, "Coastal view.jpg")];
    return Response.json({
      query: { pages: Object.fromEntries(pages.map((p) => [p.pageid, p])) },
    });
  }
  if (address.includes("upload.wikimedia.org")) {
    imageCount++;
    return new Response(fixture, { headers: { "content-type": "image/jpeg" } });
  }
  throw new Error("Unexpected request: " + address);
};
const location = (lat = 41.9028) => ({ lat, lng: 12.4964, name: "罗马" });
const context = (instruction = "街边散步") => ({
  location: location(),
  temperature: 17,
  style: "daily",
  instruction,
});
test("default uses free Commons imagery even with an existing Google key", async () => {
  const scene = await getEnvironment(location());
  assert.equal(scene.source, "commons");
  assert.equal(scene.candidates.length, 2);
  assert.equal(googleCount, 0);
  assert.equal(scene.photo.author, "Photographer & friends");
  assert.equal(scene.photo.license, "CC BY-SA 4.0");
  assert.equal(scene.photo.distance, 0);
  assert.equal(scene.photo.date, "2018-01-02");
});
test("nearby searches are shared and cache descriptors, not just one random image", async () => {
  const before = queryCount;
  const results = await Promise.all(
    Array.from({ length: 3 }, () => nearbyPhotos(location(41.903))),
  );
  assert.equal(queryCount - before, 1);
  assert.equal(results[0].length, 2);
});
test("empty search expands its radius and then falls back without Google usage", async () => {
  mode = "expanded";
  const expanded = await getEnvironment(location(42));
  assert.equal(expanded.source, "commons");
  mode = "empty";
  const before = queryCount;
  const empty = await getEnvironment(location(43));
  assert.equal(empty.source, "imagined");
  assert.equal(queryCount - before, 2);
  assert.equal(googleCount, 0);
  mode = "error";
  assert.equal((await getEnvironment(location(44))).source, "imagined");
  mode = "normal";
});
test("photo parser excludes documents, unsafe hosts, missing licenses and unusable image sizes", () => {
  assert.equal(commonsPhoto(page(103, "Map of Rome.jpg")), null);
  assert.equal(commonsPhoto(page(104, "Portrait of a person.jpg")), null);
  assert.equal(
    commonsPhoto(
      page(104, "Giammario Battaglia durante un intervento pubblico.jpg"),
    ),
    null,
  );
  const base = page(105);
  const info = base.imageinfo[0];
  for (const overrides of [
    { thumburl: "http://127.0.0.1/private" },
    { descriptionurl: "https://other.test/file" },
    { mime: "application/pdf" },
    { width: 100 },
    { extmetadata: {} },
  ])
    assert.equal(
      commonsPhoto({ ...base, imageinfo: [{ ...info, ...overrides }] }),
      null,
    );
});
test("manual selection is limited to current destination candidates and skips AI selection", async () => {
  const scene = await getEnvironment(location(), { photoId: 102 });
  assert.equal(scene.photo.id, 102);
  assert.equal(scene.manual, true);
  assert.equal(
    (
      await chooseEnvironment(scene, context(), {
        select: async () => {
          throw new Error("must not call");
        },
      })
    ).photo.id,
    102,
  );
  await assert.rejects(
    () => getEnvironment(location(), { photoId: 999 }),
    /当前地点/,
  );
});
test("vision matching maps image order to photo IDs and preserves source metadata", async () => {
  const scene = await getEnvironment(location());
  const selected = await chooseEnvironment(scene, context("视觉选择测试"), {
    select: async (prompt, images, schema, timeout) => {
      assert.equal(images.length, 2);
      assert.ok(images.every((p) => p.startsWith("data:image/jpeg;base64,")));
      assert.match(prompt, /NOT photos of the selected travelers/);
      assert.equal(timeout, 30000);
      return schema.parse({ photoId: 102, reason: "自然街景适合放入步行人物" });
    },
  });
  assert.equal(selected.photo.id, 102);
  assert.equal(selected.photo.author, "Photographer & friends");
  assert.equal(selected.candidates.length, 2);
});
test("AI rejection degrades automatically while leaving candidates available for manual choice", async () => {
  const result = await chooseEnvironment(
    await getEnvironment(location()),
    context("不适合的参考图"),
    { select: async () => ({ photoId: null, reason: "全是人物近景" }) },
  );
  assert.equal(result.source, "imagined");
  assert.equal(result.candidates.length, 2);
});
test("invalid AI IDs and model errors cannot replace trusted imagery or stop the trip", async () => {
  for (const [instruction, select] of [
    ["无效ID", async () => ({ photoId: 999, reason: "invalid" })],
    [
      "模型离线",
      async () => {
        throw new Error("offline");
      },
    ],
  ]) {
    const result = await chooseEnvironment(
      await getEnvironment(location()),
      context(instruction),
      { select },
    );
    assert.equal(result.source, "commons");
    assert.ok([101, 102].includes(result.photo.id));
    assert.match(result.reason, /AI 环境选图暂不可用/);
  }
});
test("image loading failure falls back to imagination and shared image fetches prevent duplicate downloads", async () => {
  const failed = await chooseEnvironment(
    await getEnvironment(location()),
    context("图片不可用"),
    {
      load: async () => {
        throw new Error("offline");
      },
    },
  );
  assert.equal(failed.source, "imagined");
  const before = imageCount;
  await Promise.all([environmentImage(101), environmentImage(101)]);
  assert.equal(imageCount, before);
  await assert.rejects(() => environmentImage(-1), /编号无效/);
});
test.after(async () => {
  globalThis.fetch = realFetch;
  await rm(dir, { recursive: true, force: true });
});
