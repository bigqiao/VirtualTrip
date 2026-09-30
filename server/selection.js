function byIdentityQuality(a, b) {
  const quality =
    (b.analysis?.identityQuality || 0) - (a.analysis?.identityQuality || 0);
  return (
    quality ||
    Number(hasSpecialGear(a)) - Number(hasSpecialGear(b)) ||
    a.id.localeCompare(b.id)
  );
}
const specialGearPatterns = [
  {
    gear: /救生衣|救生背心|浮力背心|life\s?jacket/i,
    activity: /皮划艇|划船|漂流|kayak|rafting|canoe|paddl|boating/i,
  },
  {
    gear: /潜水服|潜水镜|氧气瓶|wetsuit|scuba/i,
    activity: /潜水|浮潜|冲浪|diving|snorkel|surf/i,
  },
  {
    gear: /攀岩安全带|安全吊带|climbing harness/i,
    activity: /攀岩|climbing|via ferrata/i,
  },
];
function outfitText(photo) {
  return [photo.analysis?.outfit, ...(photo.analysis?.tags || [])].join(" ");
}
function hasSpecialGear(photo) {
  return specialGearPatterns.some((rule) => rule.gear.test(outfitText(photo)));
}
export function outfitFitsActivity(photo, context = {}) {
  const activity = [context.location?.name, context.instruction].join(" ");
  return specialGearPatterns.every(
    (rule) =>
      !rule.gear.test(outfitText(photo)) || rule.activity.test(activity),
  );
}
export function clothingCandidates(photos, temperature, context = {}) {
  if (!Number.isFinite(temperature)) return [];
  return photos
    .filter(
      (p) =>
        p.analysis?.hasPerson !== false &&
        p.analysis?.temperatureMin <= temperature &&
        p.analysis?.temperatureMax >= temperature &&
        outfitFitsActivity(p, context),
    )
    .sort(
      (a, b) =>
        clothingScore(b, temperature, context) -
          clothingScore(a, temperature, context) || a.id.localeCompare(b.id),
    );
}
function clothingScore(photo, temperature, context) {
  const a = photo.analysis;
  const midpoint = (a.temperatureMin + a.temperatureMax) / 2;
  const thermal =
    1 -
    Math.min(
      1,
      Math.abs(temperature - midpoint) /
        Math.max(1, (a.temperatureMax - a.temperatureMin) / 2),
    );
  const text = [a.outfit, ...(a.style || []), ...(a.tags || [])].join(" ");
  const outdoor =
    /大峡谷|山|徒步|森林|公园|峡谷|canyon|mountain|hiking|forest/i.test(
      [context.location?.name, context.instruction].join(" "),
    );
  const practical =
    outdoor && /户外|机能|运动鞋|户外鞋|徒步|舒适/i.test(text) ? 2 : 0;
  const editorial =
    context.style === "editorial" && /优雅|精致|时尚|礼服|写真|通勤/i.test(text)
      ? 1
      : 0;
  return thermal * 5 + practical + editorial + (a.identityQuality || 0) * 0.4;
}
export function chooseReference(
  photos,
  { temperature, overridePhotoId, overrideOutfit, ...context },
) {
  if (overridePhotoId) {
    const chosen = photos.find((p) => p.id === overridePhotoId);
    if (!chosen) throw new Error("指定的参考照片不可用，请重新选择。");
    return {
      photo: chosen,
      reason: "你手动指定了这套衣着",
      adapt: false,
      manual: true,
      selectionMethod: "manual",
    };
  }
  if (!photos.length) throw new Error("请先为同行人物上传并分析至少一张照片。");
  if (overrideOutfit?.trim())
    return {
      photo: [...photos].sort(byIdentityQuality)[0],
      reason: "按你指定的衣着生成",
      adapt: true,
      manual: true,
      selectionMethod: "manual",
    };
  if (typeof temperature !== "number" || !Number.isFinite(temperature))
    return {
      photo: [...photos].sort(byIdentityQuality)[0],
      reason: "天气未知，仅参考人物外貌；使用保守的分层穿搭",
      adapt: true,
      manual: false,
      selectionMethod: "adapt",
    };
  const matched = clothingCandidates(photos, temperature, context);
  if (matched.length) {
    return {
      photo: matched[0],
      reason: `${matched.length === 1 ? "只有这一套原穿搭符合天气与活动条件" : "按温度贴合程度与活动场景选择穿搭"}（${Math.round(temperature)}°C）`,
      adapt: false,
      manual: false,
      selectionMethod: "rules",
    };
  }
  return {
    photo: [...photos].sort(byIdentityQuality)[0],
    reason: `没有适合 ${Math.round(temperature)}°C 与当前活动的原穿搭；这张仅参考外貌，AI 将重新搭配衣着`,
    adapt: true,
    manual: false,
    selectionMethod: "adapt",
  };
}
// The primary image controls clothing. Extra images only strengthen identity,
// so their weather suitability must not restrict identity-reference selection.
export function chooseIdentityReferences(photos, primary, maxReferences = 3) {
  const selected = [primary];
  const seen = new Set([primary.id]);
  for (const candidate of [...photos].sort(byIdentityQuality)) {
    if (selected.length >= maxReferences) break;
    if (seen.has(candidate.id) || candidate.analysis?.hasPerson === false)
      continue;
    selected.push(candidate);
    seen.add(candidate.id);
  }
  return selected;
}
export function selectionReferences(person) {
  return person.references?.length
    ? person.references
    : [
        {
          photoId: person.photoId,
          url: person.url,
          filename: person.filename,
          appearance: person.appearance,
          subject: person.subject,
          role: person.adapt ? "identity" : "identity-outfit",
        },
      ];
}
export function allocateReferenceBudget(people, capacity = 15) {
  if (capacity < people.length)
    throw new Error("参考图预算不足以覆盖全部人物。");
  const assigned = people.map((person) => ({
    ...person,
    references: selectionReferences(person).slice(0, 1),
  }));
  let used = assigned.length;
  // Give everybody their second image before allocating any third image.
  for (let round = 1; used < capacity; round++) {
    let added = false;
    for (let i = 0; i < people.length && used < capacity; i++) {
      const next = selectionReferences(people[i])[round];
      if (!next) continue;
      assigned[i].references.push(next);
      used++;
      added = true;
    }
    if (!added) break;
  }
  return assigned;
}
export function selectionUsesPhoto(person, photoId) {
  return selectionReferences(person).some((ref) => ref.photoId === photoId);
}
export function clothingGuidance(temperature) {
  if (typeof temperature !== "number" || !Number.isFinite(temperature))
    return "Weather is unknown. Use modest, versatile layered clothing (long trousers, long sleeve top, light jacket). Do not claim actual weather.";
  if (temperature < -25)
    return "Extreme polar cold: expedition-grade insulated parka, thermal base and mid layers, insulated trousers, thick gloves, insulated winter boots and head/neck protection. Never use a light jacket, summer clothes, bare skin or ordinary thin casual layers.";
  if (temperature < 5)
    return "Freezing or very cold: insulated winter coat, long trousers, warm footwear, scarf and layers; NO summer outfit, bare legs or sleeveless tops.";
  if (temperature < 15)
    return "Cool weather: warm jacket or coat, knitwear, long trousers and closed footwear; no beach or summer outfit.";
  if (temperature < 23)
    return "Mild weather: light layers, long trousers or appropriate casual clothing, optional light jacket.";
  return "Warm weather: breathable casual clothes appropriate to the person and location.";
}
