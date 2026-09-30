import { config } from "./config.js";
import { jsonFetch } from "./ai.js";
export function validCoordinates(lat, lng) {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}
export async function getWeather(lat, lng) {
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lng),
      current: "temperature_2m,apparent_temperature,weather_code",
      timezone: "auto",
    });
    const data = await jsonFetch(url, {}, 15000);
    if (!Number.isFinite(data.current?.temperature_2m))
      throw new Error("No temperature");
    return {
      temperature: data.current.temperature_2m,
      apparentTemperature: data.current.apparent_temperature,
      code: data.current.weather_code,
      time: data.current.time,
      timezone: data.timezone,
      source: "Open-Meteo",
      status: "ok",
    };
  } catch {
    return { temperature: null, status: "unavailable", source: "Open-Meteo" };
  }
}
export async function streetMetadata(lat, lng) {
  const key = config().google.apiKey;
  if (!key)
    return {
      source: "imagined",
      reason: "尚未配置 Google 街景，自动使用 AI 想象当地场景",
    };
  try {
    const url = new URL(
      "https://maps.googleapis.com/maps/api/streetview/metadata",
    );
    url.search = new URLSearchParams({
      location: `${lat},${lng}`,
      radius: "100",
      source: "outdoor",
      key,
    });
    const data = await jsonFetch(url, {}, 15000);
    if (data.status === "OK")
      return {
        source: "streetview",
        panoId: data.pano_id,
        date: data.date,
        location: data.location,
        copyright: data.copyright,
      };
    return {
      source: "imagined",
      reason:
        data.status === "ZERO_RESULTS"
          ? "附近 100 米没有可用街景，自动想象当地场景"
          : `街景服务暂不可用（${data.status}），自动想象当地场景`,
    };
  } catch {
    return { source: "imagined", reason: "街景服务连接失败，自动想象当地场景" };
  }
}
export async function streetImage(lat, lng, heading = 0, panoId) {
  const key = config().google.apiKey;
  if (!key) throw new Error("请先配置 Google Maps API Key。");
  const url = new URL("https://maps.googleapis.com/maps/api/streetview");
  const params = {
    size: "640x640",
    heading: String(heading),
    pitch: "0",
    fov: "90",
    key,
    return_error_code: "true",
    source: "outdoor",
  };
  if (panoId) params.pano = panoId;
  else params.location = `${lat},${lng}`;
  url.search = new URLSearchParams(params);
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok || !res.headers.get("content-type")?.startsWith("image/"))
    throw new Error("无法获取街景画面");
  return Buffer.from(await res.arrayBuffer());
}
let lastSearch = 0;
const localityCache = new Map();
export function coordinateOnlyName(name = "") {
  return /^(地图选点|自选坐标) · -?\d/.test(name);
}
export async function nearbyLocality(lat, lng) {
  const id = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const cached = localityCache.get(id);
  if (cached && Date.now() - cached.time < 3600000) return cached.name;
  try {
    if (config().google.apiKey) {
      const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      url.search = new URLSearchParams({
        latlng: `${lat},${lng}`,
        key: config().google.apiKey,
        language: "zh-CN",
        result_type: "locality|administrative_area_level_1|country",
      });
      const data = await jsonFetch(url, {}, 12000);
      if (data.status === "OK")
        return data.results[0]?.formatted_address || null;
    }
    if (Date.now() - lastSearch < 1100) return null;
    lastSearch = Date.now();
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.search = new URLSearchParams({
      lat: String(lat),
      lon: String(lng),
      format: "jsonv2",
      zoom: "10",
      "accept-language": "zh-CN,en",
    });
    const data = await jsonFetch(
      url,
      {
        headers: {
          "User-Agent": "VirtualTrip/1.0 (local personal travel app)",
        },
      },
      12000,
    );
    const a = data.address || {};
    const name = [
      ...new Set(
        [a.city || a.town || a.village || a.county, a.state, a.country].filter(
          Boolean,
        ),
      ),
    ].join(" · ");
    if (name) {
      localityCache.set(id, { name, time: Date.now() });
      if (localityCache.size > 200)
        localityCache.delete(localityCache.keys().next().value);
    }
    return name || null;
  } catch {
    return null;
  }
}
export async function searchPlaces(query) {
  const key = config().google.apiKey;
  if (key) {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.search = new URLSearchParams({
      address: query,
      key,
      language: "zh-CN",
    });
    const data = await jsonFetch(url);
    if (data.status === "OK")
      return data.results.map((r) => ({
        name: r.formatted_address,
        lat: r.geometry.location.lat,
        lng: r.geometry.location.lng,
      }));
  }
  if (Date.now() - lastSearch < 1100) throw new Error("请稍等一秒再搜索。");
  lastSearch = Date.now();
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: "5",
    "accept-language": "zh-CN,en",
  });
  const rows = await jsonFetch(
    url,
    {
      headers: { "User-Agent": "VirtualTrip/1.0 (local personal travel app)" },
    },
    20000,
  );
  return rows.map((r) => ({
    name: r.display_name,
    lat: Number(r.lat),
    lng: Number(r.lon),
  }));
}
