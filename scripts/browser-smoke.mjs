import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import photographyStyles from "../shared/photography.json" with { type: "json" };
const base = process.env.VIRTUALTRIP_URL || "http://127.0.0.1:3210";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.VIRTUALTRIP_BROWSER
    ? { executablePath: process.env.VIRTUALTRIP_BROWSER }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const person = {
  id: "alice",
  name: "小雨",
  note: "测试人物",
  photoCount: 1,
  readyCount: 1,
  avatar: null,
};
const photo = {
  id: "summer",
  personId: "alice",
  personName: "小雨",
  url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="300"%3E%3Crect width="200" height="300" fill="%23e8edf8"/%3E%3C/svg%3E',
  originalName: "reference.jpg",
  status: "ready",
  analysis: {
    hasPerson: true,
    description: "短袖穿搭",
    appearance: "照片中央的人物",
    outfit: "白色短袖与短裤",
    style: ["休闲"],
    colors: ["白色"],
    seasons: ["夏季"],
    temperatureMin: 23,
    temperatureMax: 36,
    identityQuality: 0.9,
    tags: ["短袖"],
    warnings: [],
  },
};
const state = {
  people: [person],
  photos: [photo],
  trips: [],
  settings: {
    llm: {
      configured: true,
      baseUrl: "http://127.0.0.1:8317/v1",
      model: "gpt-6-luna",
      imageModel: "gpt-image-2.5-flare",
    },
    google: { configured: false },
    environment: { provider: "commons" },
  },
};
const environments = [101, 102].map((id, index) => ({
  id,
  title: `Local square ${index + 1}.jpg`,
  description: "附近广场的实拍环境",
  author: `摄影作者 ${index + 1}`,
  license: "CC BY-SA 4.0",
  licenseURL: "https://creativecommons.org/licenses/by-sa/4.0/",
  sourceURL: `https://commons.wikimedia.org/wiki/File:Local_square_${index + 1}.jpg`,
  url: photo.url,
  date: "2021-06-12",
  distance: 250 + index * 100,
  width: 1200,
  height: 800,
}));
let commonsMode = false;
const environmentScene = (id = 102, manual = false) => ({
  source: "commons",
  photo: environments.find((p) => p.id === id),
  candidates: environments,
  manual,
  reason: manual ? "使用你选择的环境照片" : "AI 选择开阔的当地广场",
});
let planRequest = null;
let tripRequest = null;
await page.route("**/api/**", async (route) => {
  const url = new URL(route.request().url());
  let response;
  if (url.pathname === "/api/state") response = state;
  else if (url.pathname === "/api/location")
    response = {
      weather: {
        status: "ok",
        temperature: -8,
        source: "Open-Meteo",
        code: 71,
      },
      scene: commonsMode
        ? environmentScene(101)
        : { source: "imagined", reason: "没有实拍，自动想象当地" },
    };
  else if (url.pathname === "/api/photos/search") response = [photo];
  else if (url.pathname === "/api/travel/preview") {
    planRequest = route.request().postDataJSON();
    response = {
      previewToken: commonsMode
        ? `commons-token-${planRequest.environmentPhotoId || 102}`
        : "browser-preview-token",
      photography: {
        style: planRequest.style,
        ...photographyStyles.find((p) => p.id === planRequest.style),
      },
      temperature: -8,
      temperatureSource: "current",
      weather: { temperature: -8 },
      scene: commonsMode
        ? environmentScene(
            planRequest.environmentPhotoId || 102,
            !!planRequest.environmentPhotoId,
          )
        : { source: "imagined", reason: "没有实拍，自动想象当地" },
      selected: [
        {
          personId: "alice",
          name: "小雨",
          photoId: "summer",
          url: photo.url,
          references: [
            { photoId: "summer", url: photo.url, role: "identity" },
            { photoId: "extra-one", url: photo.url, role: "identity" },
            { photoId: "extra-two", url: photo.url, role: "identity" },
          ],
          adapt: !planRequest.outfits.alice?.photoId,
          manual: !!planRequest.outfits.alice?.photoId,
          reason: planRequest.outfits.alice?.photoId
            ? "你手动指定了这套衣着"
            : "没有适合 -8°C 的原穿搭，AI 将调整衣着",
        },
      ],
    };
  } else if (url.pathname === "/api/trips") {
    tripRequest = route.request().postDataJSON();
    response = { id: "browser-trip", status: "queued" };
  } else if (url.pathname === "/api/settings/test")
    response = { ok: true, llmAvailable: true, imageAvailable: true };
  else
    return route.fulfill({
      status: 404,
      json: { error: "Unmocked test endpoint" },
    });
  await route.fulfill({ json: response });
});
await mkdir(".playwright", { recursive: true });
try {
  await page.goto(base, { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: "下一站，去哪里？" }),
  ).toBeVisible();
  await page.locator(".traveler").filter({ hasText: "小雨" }).click();
  await page.getByRole("textbox", { name: "留下一个想法" }).fill("街角喝咖啡");
  await page.getByRole("button", { name: "人物与照片库", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索照片特征" }).fill("短袖");
  await expect(page.locator(".photo-card")).toHaveCount(1);
  await page.getByRole("button", { name: "旅行工作台", exact: true }).click();
  await expect(page.locator(".traveler.selected")).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "留下一个想法" })).toHaveValue(
    "街角喝咖啡",
  );
  await page.getByRole("button", { name: "准备我的虚拟旅行" }).click();
  await expect(page.getByRole("dialog")).toContainText("AI 想象场景");
  await expect(page.getByRole("dialog")).toContainText("AI 将调整衣着");
  await expect(page.locator(".reference-count")).toHaveText("3 张人物参考");
  await expect(page.locator(".supplementary-references img")).toHaveCount(2);
  await page.screenshot({
    path: ".playwright/multi-reference-preview.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw new Error("Mobile reference preview overflow");
  await page.screenshot({
    path: ".playwright/multi-reference-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "确认并生成生活照" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  if (tripRequest?.previewToken !== "browser-preview-token")
    throw new Error("Reviewed preview token was not sent to generation");
  await page.locator(".outfit-list button").click();
  await page.getByRole("button", { name: "参考某套衣着" }).click();
  await page.locator(".outfit-photo-grid button").click();
  await page.getByRole("button", { name: "保存衣着选择" }).click();
  await page.getByRole("button", { name: "准备我的虚拟旅行" }).click();
  await expect(page.getByRole("dialog")).toContainText("你手动指定了这套衣着");
  if (planRequest.outfits.alice.photoId !== "summer")
    throw new Error("Manual photo selection was not sent to backend");
  await page.getByRole("button", { name: "再调整一下" }).click();
  commonsMode = true;
  await page.getByRole("button", { name: "地图选点", exact: true }).click();
  await page.locator(".map-view").click({ position: { x: 100, y: 160 } });
  await expect(page.locator(".location-strip strong").first()).toContainText(
    "地图选点",
  );
  await page.getByRole("button", { name: "环境参考", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "当地环境候选照片" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "准备我的虚拟旅行" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("当地实拍参考");
  await expect(dialog).toContainText("摄影作者 2");
  await expect(
    dialog.getByRole("button", { name: "选择环境照片 2" }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "选择环境照片 1" }).click();
  await expect(dialog).toContainText("使用你选择的环境照片");
  await expect(
    dialog.getByRole("button", { name: "选择环境照片 1" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(dialog).toContainText("CC BY-SA 4.0");
  await page.screenshot({
    path: ".playwright/commons-preview-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw new Error("Mobile Commons preview overflow");
  await page.screenshot({
    path: ".playwright/commons-preview-mobile.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "确认并生成生活照" }).click();
  await expect(dialog).toHaveCount(0);
  if (
    tripRequest.environmentPhotoId !== 101 ||
    tripRequest.previewToken !== "commons-token-101"
  )
    throw new Error(
      "Manual environment selection and reviewed token were not preserved",
    );
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const [label, description] of [
    ["胶片记忆", "细腻颗粒"],
    ["旅拍写真", "人像构图"],
    ["日常抓拍", "平视随手拍"],
    ["无人机航拍", "8–20 米"],
  ]) {
    const option = page.getByRole("button", { name: label, exact: true });
    await option.click();
    await expect(option).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".style-description")).toContainText(description);
  }
  await page.getByRole("button", { name: "准备我的虚拟旅行" }).click();
  await expect(
    page.getByRole("dialog").locator(".preview-photography"),
  ).toContainText("无人机航拍");
  if (planRequest.style !== "drone")
    throw new Error("Drone style missing from preview request");
  await page.setViewportSize({ width: 390, height: 844 });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw new Error("Mobile drone preview overflow");
  await page.screenshot({
    path: ".playwright/drone-preview-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "确认并生成生活照" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  if (tripRequest.style !== "drone")
    throw new Error("Drone style missing from generation request");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "设置与连接", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "环境照片来源" }),
  ).toHaveValue("commons");
  await page.getByRole("button", { name: "测试已保存的连接" }).click();
  await expect(page.locator(".test-results")).toContainText("生图模型可用");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "旅行工作台", exact: true }).click();
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw new Error("Mobile horizontal overflow");
  await page.screenshot({
    path: ".playwright/mobile-populated.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "人物与照片库", exact: true }).click();
  await page.getByRole("button", { name: "新建人物", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "怎么称呼这个人" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  if (errors.length) throw new Error(errors.join("; "));
  console.log(
    "Browser smoke passed: four photography styles and descriptions, drone preview and generation, navigation preserves draft, indexed search, multiple identity references, Commons AI selection, manual environment selection with confirmed token, default Google disabled, map selection, model test, desktop/mobile layout, modal focus and Escape.",
  );
} finally {
  await browser.close();
}
