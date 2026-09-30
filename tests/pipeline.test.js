import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
const dir = await mkdtemp(join(tmpdir(), "virtualtrip-tests-"));
process.env.VIRTUALTRIP_DATA_DIR = dir;
process.env.VIRTUALTRIP_CONFIG = join(dir, "config.json");
await writeFile(
  process.env.VIRTUALTRIP_CONFIG,
  JSON.stringify({
    llm: {
      baseUrl: "http://mock.test/v1",
      apiKey: "test-secret",
      model: "gpt-6-luna",
      imageModel: "gpt-image-2.5-flare",
    },
    google: { apiKey: "google-test-secret" },
    environment: { provider: "google" },
    port: 3210,
  }),
);
const { db, photo, trip, searchPhotos, people } =
  await import("../server/store.js");
const { preparePlan, runTrip, travelSchema } =
  await import("../server/travel.js");
const { streetMetadata } = await import("../server/location.js");
const realFetch = globalThis.fetch;
const fixture = await sharp({
  create: { width: 100, height: 100, channels: 3, background: "#88aaff" },
})
  .jpeg()
  .toBuffer();
await writeFile(join(dir, "photo-test.jpg"), fixture);
let streetStatus = "ZERO_RESULTS";
let lastEdit = null;
let imageFailure = false;
let wardrobePhotoId = null;
let actionResponse = [];
let lastNarrativePrompt = "";
let lastWardrobeContext = null;
let environmentInspections = 0;
let googleRequests = 0;
globalThis.fetch = async (url, options = {}) => {
  const address = String(url);
  if (address.includes("maps.googleapis.com")) googleRequests++;
  if (address.includes("commons.wikimedia.org/w/api.php"))
    return Response.json({
      query: {
        pages: {
          101: {
            pageid: 101,
            title: "File:Oslo street.jpg",
            coordinates: [{ lat: 60, lon: 10 }],
            imageinfo: [
              {
                mime: "image/jpeg",
                width: 1200,
                height: 800,
                thumburl: "https://thumb.wikimedia.org/thumb/101.jpg",
                descriptionurl:
                  "https://commons.wikimedia.org/wiki/File:Oslo_street.jpg",
                extmetadata: {
                  Artist: { value: "Test Photographer" },
                  LicenseShortName: { value: "CC BY-SA 4.0" },
                  ImageDescription: { value: "A street with space for people" },
                },
              },
            ],
          },
          102: {
            pageid: 102,
            title: "File:Oslo square.jpg",
            coordinates: [{ lat: 60, lon: 10 }],
            imageinfo: [
              {
                mime: "image/jpeg",
                width: 1200,
                height: 800,
                thumburl: "https://thumb.wikimedia.org/thumb/102.jpg",
                descriptionurl:
                  "https://commons.wikimedia.org/wiki/File:Oslo_square.jpg",
                extmetadata: {
                  Artist: { value: "Second Photographer" },
                  LicenseShortName: { value: "CC BY 3.0" },
                  ImageDescription: { value: "An open square" },
                },
              },
            ],
          },
        },
      },
    });
  if (
    address.includes("upload.wikimedia.org") ||
    address.includes("thumb.wikimedia.org")
  )
    return new Response(fixture, { headers: { "content-type": "image/jpeg" } });
  if (address.includes("api.open-meteo.com"))
    return Response.json({
      current: {
        temperature_2m: -7,
        apparent_temperature: -10,
        weather_code: 71,
        time: "2026-09-30T00:00",
      },
      timezone: "Europe/Oslo",
    });
  if (address.includes("/streetview/metadata"))
    return Response.json({
      status: streetStatus,
      pano_id: "test-pano",
      date: "2025-09",
      copyright: "Google",
      location: { lat: 60, lng: 10 },
    });
  if (address.includes("/streetview?"))
    return new Response(fixture, { headers: { "content-type": "image/jpeg" } });
  if (address.includes("nominatim.openstreetmap.org/reverse"))
    return Response.json({ address: { city: "奥斯陆", country: "挪威" } });
  if (address.includes("/chat/completions")) {
    const input = JSON.parse(options.body);
    const content = input.messages.find(
      (message) => message.role === "user",
    ).content;
    const prompt = typeof content === "string" ? content : content[0].text;
    if (prompt.includes("Choose ONE environment reference")) {
      environmentInspections++;
      assert.equal(
        content.filter((part) => part.type === "image_url").length,
        2,
      );
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                photoId: 102,
                reason: "广场开阔，适合自然散步",
              }),
            },
          },
        ],
      });
    }
    if (typeof prompt === "string" && prompt.includes("CONTEXT_JSON:")) {
      lastWardrobeContext = JSON.parse(prompt.split("CONTEXT_JSON:")[1]);
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                selections: lastWardrobeContext.people.map((p) => ({
                  personId: p.personId,
                  photoId: wardrobePhotoId || p.candidates[0].photoId,
                  reason: "场景适合这套衣着",
                })),
              }),
            },
          },
        ],
      });
    }
    lastNarrativePrompt = typeof prompt === "string" ? prompt : prompt[0].text;
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              title: "雪中的日常",
              sceneDescription: "北方小镇的雪天街道",
              photography: "自然日常抓拍",
              peopleActions: actionResponse,
            }),
          },
        },
      ],
    });
  }
  if (address.includes("/images/edits")) {
    lastEdit = options.body;
    if (imageFailure)
      return Response.json(
        { error: { message: "upstream failed" } },
        { status: 500 },
      );
    return Response.json({ data: [{ b64_json: fixture.toString("base64") }] });
  }
  throw new Error("Unexpected network: " + address);
};
db.prepare("INSERT INTO people(id,name,note,createdAt) VALUES (?,?,?,?)").run(
  "alice",
  "小雨",
  "",
  new Date().toISOString(),
);
const analysis = {
  hasPerson: true,
  appearance: "短发，正面人物",
  outfit: "白色短袖与短裤",
  temperatureMin: 25,
  temperatureMax: 35,
  identityQuality: 0.9,
};
db.prepare(
  "INSERT INTO photos(id,personId,filename,originalName,status,analysis,createdAt) VALUES (?,?,?,?,?,?,?)",
).run(
  "summer",
  "alice",
  "photo-test.jpg",
  "summer.jpg",
  "ready",
  JSON.stringify(analysis),
  new Date().toISOString(),
);
const request = travelSchema.parse({
  location: { name: "奥斯陆", lat: 60, lng: 10 },
  personIds: ["alice"],
});
function createTrip(id, req, plan) {
  db.prepare(
    "INSERT INTO trips(id,title,status,stage,request,plan,createdAt) VALUES (?,?,?,?,?,?,?)",
  ).run(
    id,
    "测试",
    "queued",
    "等待",
    JSON.stringify(req),
    JSON.stringify(plan),
    new Date().toISOString(),
  );
}
test("automatic fallback sends identity reference and winter adaptation to actual edit request", async () => {
  const plan = await preparePlan(request);
  assert.equal(plan.scene.source, "imagined");
  assert.equal(plan.temperature, -7);
  assert.equal(plan.selected[0].adapt, true);
  createTrip("fallback", request, plan);
  await runTrip("fallback", request, plan);
  const result = trip(
    db.prepare("SELECT * FROM trips WHERE id=?").get("fallback"),
  );
  assert.equal(result.status, "completed");
  assert.equal(lastEdit.getAll("image[]").length, 1);
  assert.match(lastEdit.get("prompt"), /NO summer outfit/);
  assert.match(lastEdit.get("prompt"), /No real streetview/);
  assert.ok((await readFile(join(dir, result.filename))).length > 0);
});
test("available streetview is the first image, and source remains recorded without raw image caching", async () => {
  streetStatus = "OK";
  const plan = await preparePlan(request);
  assert.equal(plan.scene.source, "streetview");
  createTrip("realstreet", request, plan);
  await runTrip("realstreet", request, plan);
  assert.equal(lastEdit.getAll("image[]").length, 2);
  assert.match(lastEdit.get("prompt"), /Image 1 is the destination/);
  const result = trip(
    db.prepare("SELECT * FROM trips WHERE id=?").get("realstreet"),
  );
  assert.equal(result.status, "completed");
  assert.deepEqual(result.plan.scene, {
    source: "streetview",
    panoId: "test-pano",
  });
});
test("manual summer clothing wins in the final generator prompt", async () => {
  streetStatus = "ZERO_RESULTS";
  const req = travelSchema.parse({
    ...request,
    outfits: { alice: { photoId: "summer" } },
  });
  const plan = await preparePlan(req);
  assert.equal(plan.selected[0].manual, true);
  createTrip("manual", req, plan);
  await runTrip("manual", req, plan);
  assert.match(lastEdit.get("prompt"), /Preserve it even if unsuitable/);
});
test("explicit temperature drives matching instead of current temperature", async () => {
  const req = travelSchema.parse({ ...request, temperature: 29 });
  const plan = await preparePlan(req);
  assert.equal(plan.temperature, 29);
  assert.equal(plan.temperatureSource, "manual");
  assert.equal(plan.selected[0].adapt, false);
});
test("upstream generation failures become retryable failed jobs", async () => {
  imageFailure = true;
  const plan = await preparePlan(request);
  createTrip("failure", request, plan);
  await runTrip("failure", request, plan);
  const result = trip(
    db.prepare("SELECT * FROM trips WHERE id=?").get("failure"),
  );
  assert.equal(result.status, "failed");
  assert.match(result.error, /upstream failed/);
  imageFailure = false;
});
test("Google API denial and missing configuration automatically fall back", async () => {
  streetStatus = "REQUEST_DENIED";
  assert.equal((await streetMetadata(60, 10)).source, "imagined");
  const current = JSON.parse(
    await readFile(process.env.VIRTUALTRIP_CONFIG, "utf8"),
  );
  current.google.apiKey = "";
  await writeFile(process.env.VIRTUALTRIP_CONFIG, JSON.stringify(current));
  const scene = await streetMetadata(60, 10);
  assert.equal(scene.source, "imagined");
  assert.match(scene.reason, /尚未配置/);
});
test("real trigram index supports Chinese short queries, long phrases, and mixed person and clothing queries", () => {
  db.prepare("INSERT INTO photo_search(photoId,text) VALUES (?,?)").run(
    "summer",
    "白色短袖与短裤 短发 正面人物",
  );
  assert.equal(searchPhotos("白色").length, 1);
  assert.equal(searchPhotos("白色短袖").length, 1);
  assert.equal(searchPhotos("小雨 白色短袖").length, 1);
  assert.equal(searchPhotos("不存在的衣服").length, 0);
  assert.equal(searchPhotos('" OR *').length, 0);
});
test("non-human images do not count as usable person references", () => {
  db.prepare(
    "INSERT INTO photos(id,personId,filename,originalName,status,analysis,createdAt) VALUES (?,?,?,?,?,?,?)",
  ).run(
    "landscape",
    "alice",
    "photo-test.jpg",
    "landscape.jpg",
    "ready",
    JSON.stringify({ ...analysis, hasPerson: false }),
    new Date().toISOString(),
  );
  assert.equal(people()[0].photoCount, 2);
  assert.equal(people()[0].readyCount, 1);
});
test("group travel sends a distinct reference and clothing rule for each selected person", async () => {
  db.prepare("INSERT INTO people(id,name,note,createdAt) VALUES (?,?,?,?)").run(
    "bob",
    "小明",
    "",
    new Date().toISOString(),
  );
  db.prepare(
    "INSERT INTO photos(id,personId,filename,originalName,status,analysis,createdAt) VALUES (?,?,?,?,?,?,?)",
  ).run(
    "bob-photo",
    "bob",
    "photo-test.jpg",
    "bob.jpg",
    "ready",
    JSON.stringify(analysis),
    new Date().toISOString(),
  );
  const req = travelSchema.parse({
    ...request,
    personIds: ["alice", "bob"],
    outfits: { bob: { instruction: "一定穿白色短袖" } },
  });
  const plan = await preparePlan(req);
  createTrip("group", req, plan);
  await runTrip("group", req, plan);
  assert.equal(lastEdit.getAll("image[]").length, 2);
  assert.match(lastEdit.get("prompt"), /exactly 2 selected foreground people/);
  assert.match(lastEdit.get("prompt"), /Person 1, name "小雨", image 1/);
  assert.match(lastEdit.get("prompt"), /Person 2, name "小明", image 2/);
  assert.match(lastEdit.get("prompt"), /一定穿白色短袖/);
  const input = lastEdit.getAll("image[]")[0];
  const metadata = await sharp(
    Buffer.from(await input.arrayBuffer()),
  ).metadata();
  assert.equal(metadata.width, 1536);
  assert.equal(metadata.height, 1024);
});
test("anonymous map coordinates acquire nearby locality for imagined scenes", async () => {
  const req = travelSchema.parse({
    ...request,
    location: { ...request.location, name: "地图选点 · 60.0000, 10.0000" },
  });
  const plan = await preparePlan(req);
  assert.equal(plan.location.name, "地图选点 · 奥斯陆 · 挪威");
});
test("invalid location and duplicate participant requests rejected", () => {
  assert.equal(
    travelSchema.safeParse({
      ...request,
      location: { lat: 92, lng: 0, name: "bad" },
    }).success,
    false,
  );
  assert.equal(
    travelSchema.safeParse({ ...request, personIds: ["alice", "alice"] })
      .success,
    false,
  );
});
test("multiple identity references keep winter clothing from only the primary image", async () => {
  const add = (id, outfit, quality, min, max) =>
    db
      .prepare(
        "INSERT INTO photos(id,personId,filename,originalName,status,analysis,createdAt) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        id,
        "alice",
        "photo-test.jpg",
        `${id}.jpg`,
        "ready",
        JSON.stringify({
          ...analysis,
          outfit,
          identityQuality: quality,
          temperatureMin: min,
          temperatureMax: max,
        }),
        new Date().toISOString(),
      );
  add("winter", "厚冬装与围巾", 0.7, -20, 5);
  add("closeup", "夏季短袖", 0.99, 24, 38);
  const plan = await preparePlan(request);
  const selected = plan.selected[0];
  assert.equal(selected.photoId, "winter");
  assert.equal(selected.adapt, false);
  assert.deepEqual(
    selected.references.map((r) => r.photoId),
    ["winter", "closeup", "summer"],
  );
  assert.deepEqual(
    selected.references.map((r) => r.role),
    ["identity-outfit", "identity", "identity"],
  );
  createTrip("multi-winter", request, plan);
  await runTrip("multi-winter", request, plan);
  assert.equal(lastEdit.getAll("image[]").length, 3);
  assert.match(
    lastEdit.get("prompt"),
    /Person 1, name "小雨", image 1 through image 3/,
  );
  assert.match(
    lastEdit.get("prompt"),
    /Reuse ONLY the suitable outfit in primary image 1: 厚冬装与围巾/,
  );
  assert.match(
    lastEdit.get("prompt"),
    /Image 2: identity ONLY, its clothing must be ignored/,
  );
  assert.match(
    lastEdit.get("prompt"),
    /ALL these images depict the SAME person/,
  );
});
test("streetview plus multiple travelers use correct per-person image ranges", async () => {
  const config = JSON.parse(
    await readFile(process.env.VIRTUALTRIP_CONFIG, "utf8"),
  );
  config.google.apiKey = "google-test-secret";
  await writeFile(process.env.VIRTUALTRIP_CONFIG, JSON.stringify(config));
  streetStatus = "OK";
  const req = travelSchema.parse({
    ...request,
    personIds: ["alice", "bob"],
    outfits: { alice: { photoId: "summer" } },
  });
  const plan = await preparePlan(req);
  assert.equal(plan.selected[0].references[0].photoId, "summer");
  createTrip("multi-street", req, plan);
  await runTrip("multi-street", req, plan);
  assert.equal(lastEdit.getAll("image[]").length, 5);
  assert.match(
    lastEdit.get("prompt"),
    /Person 1, name "小雨", image 2 through image 4/,
  );
  assert.match(lastEdit.get("prompt"), /Person 2, name "小明", image 5/);
  assert.match(
    lastEdit.get("prompt"),
    /User explicitly chose the outfit in primary image 2/,
  );
  assert.match(lastEdit.get("prompt"), /Image 1 is the destination/);
});
test("context wardrobe selection is integrated through the actual chat API and retained in generation", async () => {
  streetStatus = "ZERO_RESULTS";
  db.prepare(
    "INSERT INTO photos(id,personId,filename,originalName,status,analysis,createdAt) VALUES (?,?,?,?,?,?,?)",
  ).run(
    "city-winter",
    "alice",
    "photo-test.jpg",
    "city-winter.jpg",
    "ready",
    JSON.stringify({
      ...analysis,
      outfit: "城市厚呢外套与长裤",
      temperatureMin: -20,
      temperatureMax: 5,
      identityQuality: 0.5,
    }),
    new Date().toISOString(),
  );
  wardrobePhotoId = "city-winter";
  const req = travelSchema.parse({ ...request, instruction: "城市街边漫步" });
  const plan = await preparePlan(req);
  assert.equal(plan.selected[0].photoId, "city-winter");
  assert.equal(plan.selected[0].selectionMethod, "llm");
  assert.equal(lastWardrobeContext.instruction, "城市街边漫步");
  assert.equal(lastWardrobeContext.temperature, -7);
  assert.ok(
    lastWardrobeContext.people[0].candidates.every(
      (p) => p.photoId !== "summer",
    ),
  );
  createTrip("llm-wardrobe", req, plan);
  await runTrip("llm-wardrobe", req, plan);
  assert.match(
    lastEdit.get("prompt"),
    /Reuse ONLY the suitable outfit in primary image 1: 城市厚呢外套与长裤/,
  );
  wardrobePhotoId = null;
});
test("scene planner designs per-person poses and edit prompt ignores original reference poses", async () => {
  actionResponse = [
    { personId: "bob", action: "小明侧身看向街边，手臂自然下垂" },
    { personId: "alice", action: "小雨沿街缓步，回头微笑，双手轻放口袋" },
  ];
  const req = travelSchema.parse({
    ...request,
    personIds: ["alice", "bob"],
    instruction: "两人自然散步",
  });
  const plan = await preparePlan(req);
  createTrip("scene-poses", req, plan);
  await runTrip("scene-poses", req, plan);
  const result = trip(
    db.prepare("SELECT * FROM trips WHERE id=?").get("scene-poses"),
  );
  assert.equal(result.status, "completed");
  assert.deepEqual(result.plan.narrative.peopleActions, actionResponse);
  assert.match(
    lastNarrativePrompt,
    /exactly one action for each selected person/,
  );
  assert.match(lastNarrativePrompt, /recentActions/);
  const prompt = lastEdit.get("prompt");
  const alice = prompt.slice(
    prompt.indexOf("Person 1,"),
    prompt.indexOf("Person 2,"),
  );
  const bob = prompt.slice(prompt.indexOf("Person 2,"));
  assert.match(alice, /小雨沿街缓步/);
  assert.doesNotMatch(alice, /小明侧身/);
  assert.match(bob, /小明侧身/);
  assert.doesNotMatch(bob, /小雨沿街缓步/);
  assert.match(
    prompt,
    /Do NOT copy the stance, gesture, expression or camera-facing pose/,
  );
  assert.match(prompt, /An explicit user pose request takes priority/);
  actionResponse = [];
});
test("invalid person action mapping falls back to scene-aware poses without mixing people", async () => {
  actionResponse = [{ personId: "unknown", action: "不属于同行者的动作" }];
  const plan = await preparePlan(request);
  createTrip("invalid-poses", request, plan);
  await runTrip("invalid-poses", request, plan);
  assert.doesNotMatch(lastEdit.get("prompt"), /不属于同行者的动作/);
  assert.match(
    lastEdit.get("prompt"),
    /Create a natural new action suitable for the new scene/,
  );
  actionResponse = [];
});
test("default Commons uses vision-selected environment as image 1 and saves attribution without Google calls", async () => {
  const current = JSON.parse(
    await readFile(process.env.VIRTUALTRIP_CONFIG, "utf8"),
  );
  current.google.apiKey = "google-test-secret";
  delete current.environment;
  await writeFile(process.env.VIRTUALTRIP_CONFIG, JSON.stringify(current));
  const googleBefore = googleRequests;
  const plan = await preparePlan(request);
  assert.equal(plan.scene.source, "commons");
  assert.equal(plan.scene.photo.id, 102);
  assert.equal(environmentInspections, 1);
  createTrip("commons", request, plan);
  await runTrip("commons", request, plan);
  const result = trip(
    db.prepare("SELECT * FROM trips WHERE id=?").get("commons"),
  );
  assert.equal(result.status, "completed");
  assert.equal(
    lastEdit.getAll("image[]").length,
    plan.selected[0].references.length + 1,
  );
  assert.match(
    lastEdit.get("prompt"),
    /Image 1 is a nearby real photograph from Wikimedia Commons/,
  );
  assert.match(lastEdit.get("prompt"), /primary image 2/);
  assert.match(
    lastNarrativePrompt,
    /Existing people in that environment image are NOT selected travelers/,
  );
  assert.equal(result.plan.scene.photo.author, "Second Photographer");
  assert.equal(result.plan.scene.photo.license, "CC BY 3.0");
  assert.equal(result.plan.scene.candidates.length, 2);
  assert.equal(googleRequests, googleBefore);
});
test("manual environment choice bypasses vision selection and stays unchanged through generation", async () => {
  const req = travelSchema.parse({ ...request, environmentPhotoId: 101 });
  const plan = await preparePlan(req);
  assert.equal(plan.scene.manual, true);
  assert.equal(plan.scene.photo.id, 101);
  assert.equal(environmentInspections, 1);
  createTrip("commons-manual", req, plan);
  await runTrip("commons-manual", req, plan);
  const result = trip(
    db.prepare("SELECT * FROM trips WHERE id=?").get("commons-manual"),
  );
  assert.equal(result.plan.scene.photo.id, 101);
  assert.equal(result.plan.scene.manual, true);
  assert.equal(result.status, "completed");
});
for (const [style, label, rendering, camera] of [
  ["daily", "日常抓拍", /true-to-life color/, /eye-level handheld camera/],
  [
    "film",
    "胶片记忆",
    /fine organic film grain/,
    /intimate, relaxed eye-level/,
  ],
  [
    "editorial",
    "旅拍写真",
    /refined natural colors/,
    /50–85mm equivalent perspective/,
  ],
  [
    "drone",
    "无人机航拍",
    /coherent overhead perspective/,
    /8–20 meters above the ground/,
  ],
]) {
  test(`${style} sends explicit rendering and camera requirements to both planning and image editing`, async () => {
    const req = travelSchema.parse({
      ...request,
      style,
      moment: "night",
      environmentPhotoId: 101,
      outfits: { alice: { instruction: "一定穿红色羽绒服" } },
    });
    const plan = await preparePlan(req);
    assert.equal(plan.photography.style, style);
    assert.equal(plan.photography.label, label);
    createTrip(`photography-${style}`, req, plan);
    await runTrip(`photography-${style}`, req, plan);
    const result = trip(
      db.prepare("SELECT * FROM trips WHERE id=?").get(`photography-${style}`),
    );
    assert.equal(result.status, "completed");
    for (const prompt of [lastNarrativePrompt, lastEdit.get("prompt")]) {
      assert.match(prompt, rendering);
      assert.match(prompt, camera);
      assert.match(prompt, /nighttime exposure/);
      assert.match(prompt, /一定穿红色羽绒服/);
      assert.match(
        prompt,
        /never override the selected identities, participant count, per-person clothing instructions/,
      );
    }
    assert.equal(
      lastEdit.getAll("image[]").length,
      plan.selected[0].references.length + 1,
    );
    assert.equal(result.plan.photography.label, label);
    if (style === "drone") {
      assert.match(lastEdit.get("prompt"), /10–25 percent of image height/);
      assert.match(lastEdit.get("prompt"), /not an eye-level portrait/);
      assert.doesNotMatch(lastEdit.get("prompt"), /selected foreground people/);
    }
  });
}
test("photography style validation preserves existing modes and accepts drone without allowing arbitrary modes", () => {
  assert.equal(
    travelSchema.parse({ ...request, style: "drone" }).style,
    "drone",
  );
  assert.equal(
    travelSchema.safeParse({ ...request, style: "unknown" }).success,
    false,
  );
  const { style, ...oldRequest } = request;
  assert.equal(travelSchema.parse(oldRequest).style, "daily");
});
test.after(async () => {
  globalThis.fetch = realFetch;
  db.close();
  await rm(dir, { recursive: true, force: true });
});
