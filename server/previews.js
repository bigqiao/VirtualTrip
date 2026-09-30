import { createHash, randomUUID } from "node:crypto";
import { db } from "./store.js";
import { selectionReferences } from "./selection.js";
const previews = new Map();
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
function signature(request) {
  const { previewToken, ...rest } = request;
  return createHash("sha256")
    .update(JSON.stringify(canonical(rest)))
    .digest("hex");
}
export function savePreview(request, plan) {
  const previewToken = randomUUID();
  previews.set(previewToken, {
    signature: signature(request),
    plan: structuredClone(plan),
    createdAt: Date.now(),
  });
  if (previews.size > 200) previews.delete(previews.keys().next().value);
  return { ...plan, previewToken };
}
export function confirmedPreview(request) {
  const stored = previews.get(request.previewToken);
  if (!stored || Date.now() - stored.createdAt > 600000)
    throw new Error("预览已过期或服务已重启，请重新准备旅行。");
  if (stored.signature !== signature(request))
    throw new Error("旅行选项已变化，请重新预览后再生成。");
  for (const person of stored.plan.selected) {
    if (!db.prepare("SELECT id FROM people WHERE id=?").get(person.personId))
      throw new Error("同行人物已变动，请重新预览。");
    for (const ref of selectionReferences(person)) {
      const row = db
        .prepare("SELECT personId,status,analysis FROM photos WHERE id=?")
        .get(ref.photoId);
      if (
        !row ||
        row.personId !== person.personId ||
        row.status !== "ready" ||
        !JSON.parse(row.analysis)?.hasPerson
      )
        throw new Error("参考照片已变动，请重新预览。");
    }
  }
  return structuredClone(stored.plan);
}
