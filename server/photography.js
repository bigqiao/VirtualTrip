import styles from "../shared/photography.json" with { type: "json" };
export const photographyStyleIds = styles.map((style) => style.id);
export function photographyStyle(id = "daily") {
  const style = styles.find((item) => item.id === id);
  if (!style) throw new Error("照片风格无效");
  return style;
}
const lighting = {
  natural:
    "Use available ambient light matching the effective weather; do not automatically add a sunset or studio lights.",
  morning:
    "Use believable early-morning light and atmosphere; cloud cover and precipitation still follow the effective weather.",
  golden:
    "Use late-day golden-hour illumination where weather permits, with warm directional light and consistent long shadows; retain overcast or rainy conditions when required.",
  night:
    "Use believable nighttime exposure, available street or building illumination and a dark sky; retain realistic nighttime skin tones and avoid turning the scene into daylight.",
};
export function photographyPrompt(style, moment = "natural") {
  const preset = photographyStyle(style);
  return `Photography requirements (${preset.label}): ${preset.prompt}\nLighting requirements: ${lighting[moment] || lighting.natural}\nExplicit user camera, framing, rendering, pose and lighting wishes override photographic defaults. These defaults never override the selected identities, participant count, per-person clothing instructions or effective weather. Follow the requested camera perspective even when reference photographs use a different viewpoint.`;
}
