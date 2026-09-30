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
    assert.equal(u.searchParams.get("iiurlwidth"), "960");
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
test("drone environment matching accepts aerial imagery and can reconstruct a ground reference", async () => {
  const result = await chooseEnvironment(
    await getEnvironment(location()),
    { ...context("航拍环境测试"), style: "drone" },
    {
      select: async (prompt, images, schema) => {
        assert.match(
          prompt,
          /prefer a broad elevated or aerial environment reference/,
        );
        assert.match(prompt, /Do NOT reject an aerial photo/);
        assert.match(prompt, /A useful ground-level photo may also anchor/);
        assert.doesNotMatch(
          prompt,
          /aerial viewpoints when the people would stand at ground level/,
        );
        return schema.parse({
          photoId: 102,
          reason: "环境开阔，适合重构俯拍视角",
        });
      },
    },
  );
  assert.equal(result.source, "commons");
});
test("portrait environment matching retains a suitable ground-level preference", async () => {
  await chooseEnvironment(
    await getEnvironment(location()),
    { ...context("写真环境测试"), style: "editorial" },
    {
      select: async (prompt, images, schema) => {
        assert.match(prompt, /compositional depth/);
        assert.match(prompt, /ground-level viewpoint/);
        assert.match(
          prompt,
          /Explicit user camera and framing requests override/,
        );
        return schema.parse({ photoId: 101, reason: "适合环境人像" });
      },
    },
  );
});
async function withFetch(mock, work) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    await work();
  } finally {
    globalThis.fetch = previous;
  }
}
function thumbnailPage(id, width = 1800) {
  const result = page(id);
  result.imageinfo[0].width = width;
  result.imageinfo[0].thumburl = `https://thumb.wikimedia.org/thumb/${id}.jpg`;
  return result;
}
const imageResponse = () =>
  new Response(fixture, {
    headers: { "content-type": "image/jpeg" },
  });
test("current Commons thumbnail CDN is accepted and requested at a standard size", async () => {
  const p = thumbnailPage(201);
  assert.equal(
    new URL(commonsPhoto(p).imageURL).hostname,
    "thumb.wikimedia.org",
  );
  let calls = 0;
  await withFetch(
    async (url) => {
      const u = new URL(url);
      calls++;
      if (u.hostname === "commons.wikimedia.org") {
        assert.equal(u.searchParams.get("iiurlwidth"), "960");
        assert.equal(u.searchParams.get("pageids"), "202");
        return Response.json({
          query: { pages: { 201: p, 202: thumbnailPage(202) } },
        });
      }
      assert.equal(u.href, "https://thumb.wikimedia.org/thumb/202.jpg");
      return imageResponse();
    },
    async () => {
      const bytes = await environmentImage(202);
      assert.equal((await sharp(bytes).metadata()).format, "jpeg");
      assert.equal(calls, 2);
    },
  );
});
test("small originals are resolved into smaller standard thumbnails without fetching originals", async () => {
  for (const [id, width, expected] of [
    [203, 850, "500"],
    [204, 500, "330"],
  ]) {
    const p = page(id);
    p.imageinfo[0].width = width;
    p.imageinfo[0].thumburl = p.imageinfo[0].url;
    commonsPhoto(p);
    await withFetch(
      async (url) => {
        const u = new URL(url);
        if (u.hostname === "commons.wikimedia.org") {
          assert.equal(u.searchParams.get("iiurlwidth"), expected);
          assert.equal(u.searchParams.get("pageids"), String(id));
          return Response.json({
            query: { pages: { [id]: thumbnailPage(id, width) } },
          });
        }
        assert.equal(u.href, `https://thumb.wikimedia.org/thumb/${id}.jpg`);
        return imageResponse();
      },
      async () => assert.ok((await environmentImage(id)).length > 0),
    );
  }
});
test("thumbnail redirects follow allowed CDNs and reject other hosts before requesting them", async () => {
  commonsPhoto(page(205));
  commonsPhoto(page(206));
  const requested = [];
  await withFetch(
    async (url, options) => {
      requested.push(String(url));
      assert.equal(options.redirect, "manual");
      if (String(url).includes("upload.wikimedia.org"))
        return new Response(null, {
          status: 302,
          headers: {
            location: String(url).includes("205")
              ? "https://thumb.wikimedia.org/thumb/205.jpg"
              : "http://127.0.0.1/private",
          },
        });
      assert.equal(String(url), "https://thumb.wikimedia.org/thumb/205.jpg");
      return imageResponse();
    },
    async () => {
      assert.ok((await environmentImage(205)).length > 0);
      await assert.rejects(() => environmentImage(206), /地址无效/);
      assert.equal(requested.length, 3);
    },
  );
});
test("downloads queue at three concurrent requests and share duplicate requests", async () => {
  const ids = [210, 211, 212, 213, 214, 215];
  ids.forEach((id) => commonsPhoto(thumbnailPage(id)));
  let active = 0,
    peak = 0,
    calls = 0;
  await withFetch(
    async () => {
      calls++;
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active--;
      return imageResponse();
    },
    async () => {
      await Promise.all([...ids, ids[0], ids[0]].map(environmentImage));
      assert.equal(peak, 3);
      assert.equal(calls, 6);
    },
  );
});
test("transient image failures are cached briefly and recover after the retry window", async () => {
  commonsPhoto(thumbnailPage(220));
  let calls = 0;
  const realNow = Date.now;
  const now = realNow();
  await withFetch(
    async () => {
      if (++calls === 1) throw new Error("offline");
      return imageResponse();
    },
    async () => {
      try {
        Date.now = () => now;
        await assert.rejects(() => environmentImage(220), /offline/);
        await assert.rejects(
          () => environmentImage(220),
          (e) => e.retryAfter === 15,
        );
        assert.equal(calls, 1);
        Date.now = () => now + 16000;
        assert.ok((await environmentImage(220)).length > 0);
        assert.equal(calls, 2);
      } finally {
        Date.now = realNow;
      }
    },
  );
});
test("CDN rate limits honor Retry-After across photos and resume only after that wait", async () => {
  commonsPhoto(thumbnailPage(230));
  commonsPhoto(thumbnailPage(231));
  let calls = 0;
  const realNow = Date.now;
  const now = realNow();
  await withFetch(
    async () => {
      if (++calls === 1)
        return new Response(null, {
          status: 429,
          headers: { "retry-after": "600" },
        });
      return imageResponse();
    },
    async () => {
      try {
        Date.now = () => now;
        for (const id of [230, 230, 231])
          await assert.rejects(
            () => environmentImage(id),
            (e) => e.status === 503 && e.retryAfter === 600,
          );
        assert.equal(calls, 1);
        Date.now = () => now + 601000;
        await Promise.all([environmentImage(230), environmentImage(231)]);
        assert.equal(calls, 3);
      } finally {
        Date.now = realNow;
      }
    },
  );
});
test.after(async () => {
  globalThis.fetch = realFetch;
  await rm(dir, { recursive: true, force: true });
});
