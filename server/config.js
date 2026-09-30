import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
export const root = resolve(import.meta.dirname, "..");
export const dataDir =
  process.env.VIRTUALTRIP_DATA_DIR || resolve(root, "data");
export const configPath =
  process.env.VIRTUALTRIP_CONFIG || resolve(root, "config/local.json");
mkdirSync(dataDir, { recursive: true });
if (!existsSync(configPath)) {
  mkdirSync(resolve(root, "config"), { recursive: true });
  writeFileSync(
    configPath,
    readFileSync(resolve(root, "config/example.json")),
    { mode: 0o600 },
  );
}
export function config() {
  return JSON.parse(readFileSync(configPath, "utf8"));
}
export function saveConfig(updates) {
  const current = config();
  const next = {
    ...current,
    llm: { ...current.llm, ...updates.llm },
    google: { ...current.google, ...updates.google },
    environment: {
      provider: "commons",
      ...current.environment,
      ...updates.environment,
    },
  };
  writeFileSync(configPath, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}
export function publicConfig() {
  const c = config();
  return {
    llm: {
      baseUrl: c.llm.baseUrl,
      model: c.llm.model,
      imageModel: c.llm.imageModel,
      configured: !!c.llm.apiKey,
    },
    google: { configured: !!c.google.apiKey },
    environment: { provider: c.environment?.provider || "commons" },
  };
}
