import { test, expect } from "@playwright/test";
import { DEFAULT_CLOUD_CONFIG } from "../shared/public-config";
import { odptFixture } from "./odpt-fixture";

const url = DEFAULT_CLOUD_CONFIG.url, owner = "10000000-0000-4000-8000-000000000001";
const user = { id: owner, aud: "authenticated", role: "authenticated", email: "map@example.test", email_confirmed_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} };
const token = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: owner, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.test`;
const device = { id: "20000000-0000-4000-8000-000000000002", owner_id: owner, name: "地図試験", revision: 0, refresh_version: 0, display_enabled: true,
  last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  settings: { facilityName: "", directionDisplayMode: "separate", selectedRoutes: [], tickerText: "", updatedAt: "", devices: [{ id: "primary", code: "LCD-01", name: "メイン画面", type: "lcd", enabled: true }] } };

test("route map selects the actual station, supports zoom and pan, and prevents duplicate routes", async ({ context, page, baseURL }) => {
  await context.addInitScript(({ url, token, user }) => {
    if (location.origin !== "null") localStorage.setItem(`sb-${new URL(url).hostname.split(".")[0]}-auth-token`, JSON.stringify({ access_token: token,
      refresh_token: "test-refresh", token_type: "bearer", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user }));
  }, { url, token, user });
  await context.route("https://api.odpt.org/**", route => route.fulfill({ json: odptFixture(new URL(route.request().url())) }));
  // Exercise map rendering without sending automated traffic to OSM's public tile servers.
  await context.route("https://tile.openstreetmap.org/**", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e5e9e8"/></svg>' }));
  await context.route(`${url}/**`, route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/rest/v1/dtis_events") return route.fulfill({ json: [] });
    if (path === "/rest/v1/dtis_devices") return route.fulfill({ json: request.headers().accept?.includes("vnd.pgrst.object")
      ? { ...device, last_seen_at: new Date().toISOString() } : [{ ...device, last_seen_at: new Date().toISOString() }] });
    throw new Error(`Unexpected map test request: ${request.method()} ${path}`);
  });
  await context.routeWebSocket(`${url.replace("http", "ws")}/realtime/v1/websocket**`, ws => ws.onMessage(raw => {
    if (typeof raw !== "string") return;
    const [joinRef, ref, topic] = JSON.parse(raw);
    ws.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response: {} }]));
  }));

  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${baseURL}controller/`);
  await page.getByRole("button", { name: /クイック設定/ }).click();
  await page.getByRole("button", { name: "＋ 路線を追加する" }).click();
  const dialog = page.getByRole("dialog", { name: "路線を追加", exact: true });
  await expect(dialog.getByRole("combobox", { name: "乗り物", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("combobox", { name: "路線・系統で絞り込み", exact: true })).toHaveCount(0);
  await dialog.getByLabel("1. 駅・停留所を検索").fill("浅草");
  await dialog.getByRole("tab", { name: "マップから選ぶ" }).click();
  const map = dialog.getByRole("region", { name: "駅・停留所を選択する地図" });
  await expect(map).toBeVisible();
  await expect(map.getByRole("link", { name: "© OpenStreetMap contributors" })).toBeVisible();
  await map.getByRole("button", { name: "地図で浅草を選択", exact: true }).click();
  await expect(dialog.locator(".station-choice-summary")).toContainText("浅草");
  await expect(dialog.getByLabel("路線の候補").getByRole("button", { name: "銀座線", exact: true })).toHaveAttribute("aria-pressed", "true");

  await map.getByRole("button", { name: "地図を拡大", exact: true }).click();
  const tileLeft = await map.locator(".station-map-tiles img").first().evaluate(image => getComputedStyle(image).left);
  await map.focus(); await map.press("ArrowRight");
  await expect(map.locator(".station-map-tiles img").first()).not.toHaveCSS("left", tileLeft);
  const bounds = (await map.boundingBox())!;
  const leftBeforeDrag = await map.locator(".station-map-tiles img").first().evaluate(image => getComputedStyle(image).left);
  await page.mouse.move(bounds.x + 70, bounds.y + 70); await page.mouse.down();
  await page.mouse.move(bounds.x + 130, bounds.y + 90, { steps: 5 }); await page.mouse.up();
  await expect(map.locator(".station-map-tiles img").first()).not.toHaveCSS("left", leftBeforeDrag);
  await map.getByRole("button", { name: "全体", exact: true }).click();
  await page.screenshot({ path: "artifacts/pages-route-map.png", fullPage: true });
  await dialog.getByRole("button", { name: "追加する", exact: true }).click();
  await expect(page.getByLabel("登録した路線").locator(".route-card")).toHaveCount(1);
  await expect(page.getByLabel("登録した路線")).toContainText("浅草");

  await page.getByRole("button", { name: "＋ 路線を追加する" }).click();
  await dialog.getByLabel("1. 駅・停留所を検索").fill("G19");
  await dialog.getByLabel("駅・停留所の候補").getByRole("button", { name: /浅草/ }).click();
  await expect(dialog.getByRole("button", { name: "追加済み", exact: true })).toBeDisabled();
  await dialog.getByRole("tab", { name: "マップから選ぶ" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(map).toBeVisible();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/pages-route-map-mobile.png", fullPage: true });
  await dialog.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(page.getByLabel("登録した路線").locator(".route-card")).toHaveCount(1);
  expect(errors).toEqual([]);
});
