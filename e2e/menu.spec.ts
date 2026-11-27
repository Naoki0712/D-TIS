import { test, expect, type Page } from "@playwright/test";
import { DEFAULT_CLOUD_CONFIG } from "../shared/public-config";

const cloud = DEFAULT_CLOUD_CONFIG.url;
const user = { id: "40000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "menu@example.test", app_metadata: {}, user_metadata: {} };
const token = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, role: "authenticated", exp: 2000000000 })).toString("base64url")}.fixture`;
const devices = ["受付モニター", "待合室モニター"].map((name, index) => ({
  id: `40000000-0000-4000-8000-00000000000${index + 2}`, owner_id: user.id, name,
  revision: 0, refresh_version: 0, display_enabled: true, last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  settings: { facilityName: "", directionDisplayMode: "separate", selectedRoutes: [], tickerText: "", updatedAt: "",
    devices: [{ id: "primary", code: "LCD-01", name, type: "lcd", enabled: true }] },
}));

async function mockAccount(page: Page) {
  let logouts = 0;
  await page.addInitScript(({ cloud, token, user }) => {
    localStorage.setItem(`sb-${new URL(cloud).hostname.split(".")[0]}-auth-token`, JSON.stringify({ access_token: token,
      refresh_token: "fixture", token_type: "bearer", expires_at: 2000000000, expires_in: 3600, user }));
  }, { cloud, token, user });
  await page.route("https://api.odpt.org/**", route => route.fulfill({ json: [] }));
  await page.route(`${cloud}/**`, route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/auth/v1/logout") { logouts++; return route.fulfill({ status: 204 }); }
    if (url.pathname === "/auth/v1/user") return route.fulfill({ json: user });
    if (url.pathname === "/rest/v1/dtis_devices") return route.fulfill({ json: url.searchParams.has("id") ? devices[0] : devices });
    if (url.pathname.endsWith("dtis_connect")) return route.fulfill({ json: devices[0] });
    return route.fulfill({ json: null });
  });
  await page.routeWebSocket(`${cloud.replace("http", "ws")}/realtime/v1/websocket**`, ws => {
    ws.onMessage(raw => {
      if (typeof raw !== "string") return;
      const [join, ref, topic] = JSON.parse(raw);
      ws.send(JSON.stringify([join, ref, topic, "phx_reply", { status: "ok", response: {} }]));
    });
  });
  return () => logouts;
}

test("portal menus link to all pages and sections at desktop and mobile widths", async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(baseURL!);
  const products = page.getByRole("navigation", { name: "ページ切替" });
  await expect(products.getByRole("link", { name: "ポータルサイト" })).toHaveAttribute("aria-current", "page");
  await expect(products.getByRole("link", { name: "Signage", exact: true })).toHaveAttribute("href", /\/signage\/$/);
  await expect(products.getByRole("link", { name: "Controller", exact: true })).toHaveAttribute("href", /\/controller\/$/);
  const sections = page.getByRole("navigation", { name: "メインナビゲーション" });
  for (const width of [1366, 720, 390, 320]) {
    await page.setViewportSize({ width, height: 768 });
    await expect(sections.getByRole("link", { name: "トップ", exact: true })).toBeVisible();
    expect(await products.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/menu-portal-${width}.png` });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await sections.getByRole("link", { name: "データ集" }).click();
  await expect(sections.getByRole("link", { name: "データ集" })).toHaveAttribute("aria-current", "location");
  expect(errors).toEqual([]);
});

test("Controller device menu selects devices and moves device controls into quick settings", async ({ page, baseURL }) => {
  await mockAccount(page);
  await page.goto(`${baseURL}controller/`);
  const menu = page.getByRole("navigation", { name: "Signage一覧" });
  await expect(menu.getByRole("button", { name: /^受付モニター 接続/ })).toHaveAttribute("aria-pressed", "true");
  await menu.getByRole("button", { name: /^待合室モニター 接続/ }).click();
  await expect(menu.getByRole("button", { name: /^待合室モニター 接続/ })).toHaveAttribute("aria-pressed", "true");
  await expect(menu.locator(".book-settings")).toHaveCount(0);
  await page.getByRole("button", { name: /クイック設定/ }).click();
  await expect(page.getByRole("region", { name: "デバイス設定" })).toBeVisible();
  await expect(page.getByRole("region", { name: "デバイス設定" }).getByLabel("デバイス名", { exact: true })).toHaveValue("待合室モニター");
  for (const width of [1366, 390, 320]) {
    await page.setViewportSize({ width, height: 768 });
    expect(await page.locator(".d-tis-products").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const before = await menu.locator(".book-select").first().boundingBox();
    await menu.evaluate(el => { el.scrollLeft = el.scrollWidth; });
    const after = await menu.locator(".book-select").first().boundingBox();
    expect(after!.y).toBe(before!.y); expect(after!.height).toBe(before!.height);
    expect(await menu.evaluate(el => getComputedStyle(el).scrollbarWidth)).toBe("thin");
    await page.screenshot({ path: `artifacts/menu-controller-${width}.png` });
  }
});

test("Signage menu collapses without hiding the display and disconnects through local logout", async ({ page, baseURL }) => {
  const logouts = await mockAccount(page);
  await page.goto(`${baseURL}signage/?device=${devices[0].id}`);
  await expect(page.getByText("デバイス名：受付モニター", { exact: true })).toBeVisible();
  for (const width of [1366, 390, 320]) {
    await page.setViewportSize({ width, height: 768 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/menu-signage-${width}.png` });
  }
  await page.getByRole("button", { name: "メニューを隠す" }).click();
  await expect(page.getByRole("navigation", { name: "ページ切替" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "表示する路線を追加してください" })).toBeVisible();
  await page.getByRole("button", { name: "メニューを表示" }).click();
  await expect(page.getByRole("navigation", { name: "ページ切替" })).toBeVisible();
  await page.getByRole("button", { name: "Controllerとの連携を解除" }).click();
  await expect(page.getByRole("heading", { name: "D-TISにログイン" })).toBeVisible();
  expect(logouts()).toBe(1);
});

test("Signage menu auto-collapses after five idle seconds and activity resets the timer", async ({ page, baseURL }) => {
  await page.clock.install({ time: new Date("2026-11-27T03:00:00Z") });
  await page.clock.pauseAt(new Date("2026-11-27T03:00:01Z"));
  await mockAccount(page);
  await page.goto(`${baseURL}signage/?device=${devices[0].id}`);
  const hide = page.getByRole("button", { name: "メニューを隠す" });
  await expect(hide).toHaveAttribute("aria-expanded", "true");
  await page.clock.fastForward(4000);
  await page.mouse.move(200, 200);
  await page.clock.fastForward(4000);
  await expect(hide).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Shift");
  await page.clock.fastForward(4999);
  await expect(hide).toHaveAttribute("aria-expanded", "true");
  await page.clock.fastForward(1);
  const show = page.getByRole("button", { name: "メニューを表示" });
  await expect(show).toHaveAttribute("aria-expanded", "false");
  await page.clock.runFor(350);
  await expect(page.locator(".app-menu-overlay .app-header")).toHaveCSS("visibility", "hidden");
  await show.click();
  await expect(hide).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("link", { name: "Signage", exact: true }).focus();
  await page.clock.fastForward(5000);
  await expect(show).toHaveAttribute("aria-expanded", "false");
  await expect(show).toBeFocused();
});

test("Signage menu overlays the display without moving it during opening or closing", async ({ page, baseURL }) => {
  await mockAccount(page);
  await page.goto(`${baseURL}signage/?device=${devices[0].id}`);
  await expect(page.getByText("デバイス名：受付モニター", { exact: true })).toBeVisible();
  const geometry = () => page.evaluate(() => [".signage-display-header", ".signage-content"].map(selector => {
    const rect = document.querySelector(selector)!.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 768 });
    await expect(page.getByRole("button", { name: "メニューを隠す" })).toBeVisible();
    const open = await geometry();
    expect(open[0].y).toBe(0);
    await page.getByRole("button", { name: "メニューを隠す" }).click();
    expect(await geometry()).toEqual(open);
    await expect(page.getByRole("navigation", { name: "ページ切替" })).toBeHidden();
    await expect(page.locator(".app-menu-overlay .app-header")).toHaveCSS("visibility", "hidden");
    expect(await geometry()).toEqual(open);
    await page.screenshot({ path: `artifacts/signage-overlay-collapsed-${width}.png` });
    await page.getByRole("button", { name: "メニューを表示" }).click();
    await expect(page.getByRole("navigation", { name: "ページ切替" })).toBeVisible();
    expect(await geometry()).toEqual(open);
    await page.screenshot({ path: `artifacts/signage-overlay-open-${width}.png`, animations: "disabled" });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "メニューを隠す" }).click();
  await expect(page.getByRole("navigation", { name: "ページ切替" })).toBeHidden();
});
