import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { dataDir } from "./config.js";
import { db, photo, updateTrip } from "./store.js";
import { getWeather, nearbyLocality, coordinateOnlyName } from "./location.js";
import {
  clothingGuidance,
  chooseIdentityReferences,
  allocateReferenceBudget,
  selectionReferences,
} from "./selection.js";
import { llmJSON, generateImage } from "./ai.js";
import { matchWardrobes } from "./wardrobe.js";
import {
  photographyStyleIds,
  photographyStyle,
  photographyPrompt,
} from "./photography.js";
import {
  getEnvironment,
  chooseEnvironment,
  sceneImage,
} from "./environment.js";
export const travelSchema = z.object({
  previewToken: z.string().uuid().optional(),
  environmentPhotoId: z.number().int().positive().optional(),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    name: z.string().trim().min(1).max(300),
  }),
  personIds: z
    .array(z.string())
    .min(1)
    .max(6)
    .refine((ids) => new Set(ids).size === ids.length),
  outfits: z
    .record(
      z.string(),
      z.object({
        photoId: z.string().optional(),
        instruction: z.string().max(1000).optional(),
      }),
    )
    .default({}),
  temperature: z.number().min(-50).max(60).nullable().default(null),
  heading: z.number().min(0).max(360).default(0),
  style: z.enum(photographyStyleIds).default("daily"),
  moment: z.enum(["natural", "morning", "golden", "night"]).default("natural"),
  aspect: z.enum(["landscape", "portrait", "square"]).default("landscape"),
  instruction: z.string().max(2000).default(""),
});
export async function preparePlan(request) {
  const { location } = request;
  const [weather, discoveredScene, locality] = await Promise.all([
    getWeather(location.lat, location.lng),
    getEnvironment(location, { photoId: request.environmentPhotoId }),
    coordinateOnlyName(location.name)
      ? nearbyLocality(location.lat, location.lng)
      : null,
  ]);
  const temperature = request.temperature ?? weather.temperature;
  const resolvedLocation = locality
    ? { ...location, name: `地图选点 · ${locality}` }
    : location;
  const recentTrips = db
    .prepare(
      "SELECT plan FROM trips WHERE status='completed' ORDER BY createdAt DESC LIMIT 12",
    )
    .all();
  const travelers = request.personIds.map((id) => {
    const person = db.prepare("SELECT * FROM people WHERE id=?").get(id);
    if (!person) throw new Error("选择的人物已被删除，请重新选择。");
    const available = db
      .prepare(
        "SELECT * FROM photos WHERE personId=? AND status='ready' ORDER BY createdAt DESC",
      )
      .all(id)
      .map(photo)
      .filter((p) => p.analysis?.hasPerson);
    const override = request.outfits[id] || {};
    const recentOutfitIds = recentTrips.flatMap((row) => {
      const selection = JSON.parse(row.plan || "{}").selected?.find(
        (p) => p.personId === id,
      );
      return selection && !selection.adapt && !selection.manual
        ? [selection.photoId]
        : [];
    });
    const recentActions = recentTrips
      .flatMap((row) => {
        const action = JSON.parse(
          row.plan || "{}",
        ).narrative?.peopleActions?.find((p) => p.personId === id)?.action;
        return action ? [action] : [];
      })
      .slice(0, 3);
    return {
      ...person,
      photos: available,
      override,
      recentOutfitIds,
      recentActions,
    };
  });
  const context = {
    location: resolvedLocation,
    temperature,
    weather,
    style: request.style,
    moment: request.moment,
    instruction: request.instruction,
  };
  const [matched, scene] = await Promise.all([
    matchWardrobes(travelers, context),
    chooseEnvironment(discoveredScene, context),
  ]);
  const selected = matched.map((person) => {
    const { chosen, override } = person;
    const id = person.id;
    return {
      personId: id,
      name: person.name,
      note: person.note,
      recentActions: person.recentActions,
      photoId: chosen.photo.id,
      url: chosen.photo.url,
      filename: chosen.photo.filename,
      appearance: chosen.photo.analysis.appearance,
      outfit: chosen.photo.analysis.outfit,
      reason: chosen.reason,
      adapt: chosen.adapt,
      manual: chosen.manual,
      selectionMethod: chosen.selectionMethod,
      instruction: override.instruction || "",
      subject: chosen.photo.subject,
      references: chooseIdentityReferences(person.photos, chosen.photo).map(
        (reference, index) => ({
          photoId: reference.id,
          url: reference.url,
          filename: reference.filename,
          appearance: reference.analysis.appearance,
          subject: reference.subject,
          role: index === 0 && !chosen.adapt ? "identity-outfit" : "identity",
        }),
      ),
    };
  });
  return {
    location: resolvedLocation,
    photography: {
      style: request.style,
      label: photographyStyle(request.style).label,
      summary: photographyStyle(request.style).summary,
    },
    weather,
    temperature,
    temperatureSource:
      request.temperature !== null
        ? "manual"
        : weather.status === "ok"
          ? "current"
          : "unknown",
    scene,
    selected: allocateReferenceBudget(
      selected,
      scene.source === "imagined" ? 16 : 15,
    ),
  };
}
const narrativeSchema = z.object({
  title: z.string(),
  sceneDescription: z.string(),
  photography: z.string(),
  peopleActions: z
    .array(
      z.object({
        personId: z.string(),
        action: z.string().trim().min(1).max(700),
      }),
    )
    .default([]),
});
export async function runTrip(id, request, plan) {
  try {
    const photoRequirements = photographyPrompt(request.style, request.moment);
    updateTrip(id, "正在观察目的地", "running", { plan });
    let street = null;
    if (plan.scene.source !== "imagined") {
      try {
        street = await sceneImage(plan.scene, request);
      } catch {
        plan.scene = {
          source: "imagined",
          reason: "环境参考画面获取失败，自动想象当地场景",
        };
        updateTrip(id, "参考照片不可用，正在想象当地场景", "running", { plan });
      }
    }
    const narrative = await llmJSON(
      `Write a location-grounded, photorealistic travel photo brief in Chinese. Destination=${JSON.stringify(plan.location)}. Weather=${JSON.stringify(plan.weather)}, effective temperature=${plan.temperature}, temperature source=${plan.temperatureSource}. Environment reference present=${!!street}, source=${plan.scene.source}. Reference metadata=${JSON.stringify(plan.scene.photo ? { title: plan.scene.photo.title, description: plan.scene.photo.description, distanceMeters: plan.scene.photo.distance, captured: plan.scene.photo.date } : null)}. If an environment photo is present, ground the brief in its visible environment; any view-dependent reconstruction needed for an elevated camera is plausible inference, not verified imagery. Do not invent unrelated objects or landmarks. Use the destination as context without claiming the photo was taken at the exact clicked point or in current weather. Keep recognizable architecture and terrain, adapt weather and light to this request. Existing people in that environment image are NOT selected travelers. If no environment photo, infer plausible architecture, vegetation and street life based on this location, never assert invented details as verified; do not invent a famous landmark at an arbitrary point. Global user creative wishes=${JSON.stringify(request.instruction)}. ${photoRequirements} Avoid travel-advertisement montages; follow the selected photography requirements rather than defaulting every mode to a candid snapshot. People=${JSON.stringify(plan.selected.map((p) => ({ personId: p.personId, name: p.name, appearance: p.appearance, clothing: p.manual ? p.instruction || p.outfit : p.adapt ? clothingGuidance(plan.temperature) : p.outfit, recentActions: p.recentActions || [] })))}. Design a fresh, natural scene-appropriate action for EACH selected person: specify body orientation, arm/hand placement, gaze and expression, and believable interaction with surroundings or other travelers. Examples are walking on a city pavement, pausing to admire a view, holding a warm drink in a suitable cafe, or paddling only when the requested activity supports it. Respect the effective weather, clothing, terrain and exact number of selected people; avoid unsupported props, dangerous positions and uniform stiff poses. Reference photos anchor identity and chosen clothes only: their original stance, gestures and gaze MUST NOT be copied. Treat any pose in appearance descriptions only as an identification hint, not as a direction. When several actions are equally natural, avoid repeating the person's recentActions; never sacrifice scene appropriateness just to force variation. Honor explicit user pose requests. Return JSON {title:string (short Chinese destination title), sceneDescription:string, photography:string, peopleActions:[{personId:string,action:string}]}, exactly one action for each selected person.`,
      street ? [`data:image/jpeg;base64,${street.toString("base64")}`] : [],
      narrativeSchema,
    );
    // Incomplete or duplicated action mappings cannot leak another person's direction.
    if (
      narrative.peopleActions.length &&
      (narrative.peopleActions.length !== plan.selected.length ||
        new Set(narrative.peopleActions.map((p) => p.personId)).size !==
          plan.selected.length ||
        narrative.peopleActions.some(
          (p) =>
            !plan.selected.some((selected) => selected.personId === p.personId),
        ))
    )
      narrative.peopleActions = [];
    plan.narrative = narrative;
    // Keep only panorama ID and derived creative brief; raw Google imagery is ephemeral.
    if (plan.scene.source === "streetview")
      plan.scene = { source: "streetview", panoId: plan.scene.panoId };
    updateTrip(id, "正在生成旅行照片", "running", {
      plan,
      title: narrative.title,
    });
    const files = [];
    if (street) files.push({ bytes: street });
    let nextImageIndex = street ? 2 : 1;
    const peopleInstructions = [];
    for (const [i, p] of plan.selected.entries()) {
      const references = selectionReferences(p);
      const firstIndex = nextImageIndex;
      const mapped = [];
      for (const reference of references) {
        files.push({
          bytes: await readFile(resolve(dataDir, reference.filename)),
        });
        mapped.push(
          `Image ${nextImageIndex}: ${reference.role === "identity-outfit" ? "primary identity AND clothing reference" : "identity ONLY, its clothing must be ignored"}. Subject identification hint (NOT a pose direction): ${reference.subject || reference.appearance || p.appearance}.`,
        );
        nextImageIndex++;
      }
      const action = narrative.peopleActions.find(
        (action) => action.personId === p.personId,
      )?.action;
      peopleInstructions.push(
        `Person ${i + 1}, name ${JSON.stringify(p.name)}, image ${firstIndex}${references.length > 1 ? ` through image ${nextImageIndex - 1}` : ""}: ALL these images depict the SAME person, not additional people. Use their clearest visible faces together to preserve this person's facial identity, hair, proportions and distinctive features; never blend faces across different selected people or duplicate people. ${mapped.join(" ")} Pose and action: ${action || "Create a natural new action suitable for the new scene, effective weather and user wishes."}. Re-pose this person for the new environment: change body orientation, arms/hands, gaze and interaction as appropriate. Do NOT copy the stance, gesture, expression or camera-facing pose from any reference photo. These images anchor appearance and selected clothing only. An explicit user pose request takes priority over inferred action. Clothing: ${p.manual ? p.instruction || `User explicitly chose the outfit in primary image ${firstIndex}: ${p.outfit}. Preserve it even if unsuitable for temperature.` : p.adapt ? `Adapt to ${plan.temperature} Celsius: ${clothingGuidance(plan.temperature)}. Original clothes in ALL reference images are NOT a wardrobe instruction.` : `Reuse ONLY the suitable outfit in primary image ${firstIndex}: ${p.outfit}`}. ${p.instruction ? `Explicit clothing override: ${p.instruction}` : ""} Supplementary images are exclusively for identity; NEVER borrow their clothes, accessories or backgrounds.`,
      );
    }
    const prompt = `Generate a believable photorealistic virtual travel daily-life photograph with exactly ${plan.selected.length} selected ${request.style === "drone" ? "travelers visible within the environment" : "foreground people"}. Their real identities MUST be grounded in the supplied individual reference images. Several references can depict the same person: follow the per-person image grouping below; the number of reference images is NOT the number of people. ${street ? (plan.scene.source === "commons" ? "Image 1 is a nearby real photograph from Wikimedia Commons, used ONLY as an environment reference. Preserve visible local architecture, terrain and street geometry, adapting weather and lighting to the request. People already in image 1 are NOT the selected travelers and must not determine their identities or poses. Do not claim exact clicked-coordinate accuracy. The following images are the selected people references." : "Image 1 is the destination street environment reference. Preserve its visible architecture, street geometry and environment; use the following images as individual people references.") : "No real streetview or usable environment photo is available. Create a plausible imagined environment of the location; do not claim exact documentary accuracy."}\nLocation: ${JSON.stringify(plan.location)}. Scene: ${narrative.sceneDescription}. Photo direction: ${narrative.photography}. Lighting preference: ${request.moment}. Style: ${request.style}.\n${photoRequirements}\nTemperature: ${plan.temperature}, source: ${plan.temperatureSource}; weather: ${JSON.stringify(plan.weather)}.\n${peopleInstructions.join("\n")}\nGlobal creative wishes: ${request.instruction || "Believable travel moment with scene-appropriate actions following the selected photography requirements."}\nGlobal wishes can guide pose and mood but MUST NOT override per-person clothing choices unless an explicit per-person clothing override is present. Vary scene-appropriate actions naturally across participants; avoid identical rigid poses and a pasted cutout appearance. Place feet and hands naturally in the new scene with consistent natural perspective, shadows and lighting. No face mixing, extra selected people, collages, text captions, signatures or frames. Scene and people should form one cohesive photograph.`;
    const sizes = {
      landscape: "1536x1024",
      portrait: "1024x1536",
      square: "1024x1024",
    };
    const bytes = await generateImage(prompt, files, sizes[request.aspect]);
    const filename = `trip-${id}.jpg`;
    await sharp(bytes)
      .rotate()
      .jpeg({ quality: 94 })
      .toFile(resolve(dataDir, filename));
    updateTrip(id, "已收入旅行相册", "completed", { filename, plan });
  } catch (e) {
    updateTrip(id, "生成失败", "failed", { error: e.message.slice(0, 700) });
  }
}
