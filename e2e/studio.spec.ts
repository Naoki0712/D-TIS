import { test, expect, webkit, type BrowserContext, type WebSocketRoute } from "@playwright/test";
import { existsSync } from "node:fs";
import { DEFAULT_CLOUD_CONFIG } from "../shared/public-config";
import { odptFixture } from "./odpt-fixture";
import type { DeviceRecord } from "../shared/cloud";

const url = DEFAULT_CLOUD_CONFIG.url, owner = "10000000-0000-4000-8000-000000000001";
const user = { id: owner, aud: "authenticated", role: "authenticated", email: "studio@example.test", email_confirmed_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} };
const token = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: owner, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.test`;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6mHsAAAAASUVORK5CYII=", "base64");

function backend() {
  const rows = new Map<string, DeviceRecord>(), uploads: string[] = [], applied: string[] = [];
  const sockets = new Set<{ ws: WebSocketRoute; topics: Set<string> }>();
  async function attach(context: BrowserContext) {
    await context.addInitScript(({ url, token, user }) => {
      if (location.origin === "null") return;
      localStorage.setItem(`sb-${new URL(url).hostname.split(".")[0]}-auth-token`, JSON.stringify({
        access_token: token, refresh_token: "test-refresh", token_type: "bearer", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user,
      }));
    }, { url, token, user });
    await context.route("https://api.odpt.org/**", route => route.fulfill({ json: odptFixture(new URL(route.request().url())) }));
    await context.route("https://assets.example.test/**", route => route.fulfill({ contentType: "image/png", body: png }));
    await context.route(`${url}/**`, async route => {
      const request = route.request(), path = new URL(request.url()), body = request.method() === "POST" && request.headers()["content-type"]?.includes("json") ? request.postDataJSON() : {};
      const json = (data: unknown, status = 200) => route.fulfill({ status, json: data });
      if (path.pathname === "/auth/v1/user") return json(user);
      if (path.pathname === "/auth/v1/token") return json({ access_token: token, refresh_token: "test-refresh", expires_in: 3600, user });
      if (path.pathname.startsWith("/storage/v1/object/sign/") && request.method() === "POST") return json({ signedURL: "/object/sign/dtis-media/test.png?token=test" });
      if (path.pathname.startsWith("/storage/v1/object/") && request.method() === "POST") { uploads.push(path.pathname); return json({ Key: path.pathname, Id: crypto.randomUUID() }); }
      if (path.pathname.startsWith("/storage/v1/object/")) return route.fulfill({ contentType: "image/png", body: png });
      if (path.pathname === "/rest/v1/dtis_devices") {
        if (request.method() === "POST") {
          const record = { ...body, revision: 0, refresh_version: 0, display_enabled: true, last_seen_at: null, updated_at: new Date().toISOString() };
          rows.set(record.id, record); return json(record);
        }
        const id = path.searchParams.get("id")?.replace(/^eq\./, "");
        const values = id ? [...rows.values()].filter(row => row.id === id) : [...rows.values()];
        return json(request.headers().accept?.includes("vnd.pgrst.object") ? values[0] ?? null : values);
      }
      if (path.pathname === "/rest/v1/dtis_events") return json([]);
      const record = rows.get(body.p_device_id);
      if (!record) return json({ message: "device_not_found" }, 404);
      if (path.pathname.endsWith("/dtis_connect")) {
        record.last_connection_kind = record.last_connected_at || record.last_seen_at ? "existing" : "new";
        record.last_connected_at = record.last_seen_at = new Date().toISOString(); return json(record);
      }
      if (path.pathname.endsWith("/dtis_heartbeat")) { record.last_seen_at = new Date().toISOString(); return json(null); }
      if (path.pathname.endsWith("/dtis_commit_applied")) {
        expect(body.p_expected_revision).toBe(record.revision);
        Object.assign(record, { revision: record.revision + 1, settings: body.p_settings, display_enabled: body.p_display_enabled, refresh_version: body.p_refresh_version, updated_at: new Date().toISOString() });
        applied.push(record.id); return json(record);
      }
      throw new Error(`Unexpected request: ${request.method()} ${path.pathname}`);
    });
    await context.routeWebSocket(`${url.replace("http", "ws")}/realtime/v1/websocket**`, ws => {
      const client = { ws, topics: new Set<string>() }; sockets.add(client);
      ws.onClose(() => sockets.delete(client));
      ws.onMessage(raw => {
        let message: any[];
        if (typeof raw === "string") message = JSON.parse(raw);
        else {
          let offset = 7;
          const fields = [...raw.subarray(1, 6)].map(size => { const value = raw.subarray(offset, offset + size).toString("utf8"); offset += size; return value; });
          message = [fields[0], fields[1], fields[2], "broadcast", { event: fields[3], payload: JSON.parse(raw.subarray(offset).toString("utf8")) }];
        }
        const [join, ref, topic, event, payload] = message;
        ws.send(JSON.stringify([join, ref, topic, "phx_reply", { status: "ok", response: {} }]));
        if (event === "phx_join") client.topics.add(topic);
        if (event === "phx_leave") client.topics.delete(topic);
        if (event === "broadcast") for (const peer of sockets) if (peer !== client && peer.topics.has(topic)) peer.ws.send(JSON.stringify([null, null, topic, "broadcast", { type: "broadcast", ...payload }]));
      });
    });
  }
  return { rows, uploads, applied, attach };
}

test("one account controls independent Signages and persists fonts, GPS, media, and character styling", async ({ browser, baseURL }) => {
  test.setTimeout(90000);
  const api = backend(), context = await browser.newContext({ viewport: { width: 1024, height: 768 }, geolocation: { latitude: 35, longitude: 139 }, permissions: ["geolocation"] });
  await api.attach(context);
  const errors: string[] = []; context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
  const controller = await context.newPage(), first = await context.newPage(), second = await context.newPage();
  try {
    await controller.goto(`${baseURL}controller/`);
    async function add(name: string) {
      await controller.getByRole("button", { name: "＋ Signageを追加" }).click();
      const dialog = controller.getByRole("dialog", { name: "Signageを追加", exact: true });
      await dialog.getByLabel("デバイス名", { exact: true }).fill(name);
      await dialog.getByRole("button", { name: "追加する", exact: true }).click();
      const address = await dialog.getByLabel("専用URL", { exact: true }).inputValue();
      await dialog.getByRole("button", { name: "閉じる" }).click();
      return address;
    }
    const a = await add("入口"), aId = new URL(a).searchParams.get("device")!;
    await first.goto(a); await expect(first.locator(".app-facility")).toContainText("入口");
    const b = await add("受付"), bId = new URL(b).searchParams.get("device")!;
    await second.goto(b); await expect(second.locator(".app-facility")).toContainText("受付");
    await expect(controller.locator(".connection-notices")).toContainText("新しいSignageが接続しました", { timeout: 12000 });
    await controller.getByRole("button", { name: /入口.*接続中/ }).click();
    await expect(controller.getByLabel("施設名", { exact: true })).toBeEnabled();
    await controller.getByLabel("書体のプリセット").selectOption("mincho");
    await controller.getByLabel("乗り物が入れ替わるときの効果").selectOption("split-flap");
    await controller.getByLabel("移動時間の設定").selectOption("gps");
    await controller.getByRole("button", { name: "このデバイスのGPSで設置場所を取得" }).click();
    await expect(controller.getByLabel("設置場所の緯度")).toHaveValue("35");
    await controller.getByLabel("推定に追加する時間（分）").fill("4");
    const ticker = controller.getByLabel("画面下部のスクロール文面");
    await ticker.fill("安全にお進みください");
    await ticker.press("Home");
    await ticker.press("Shift+ArrowRight");
    await ticker.press("Shift+ArrowRight");
    await controller.getByLabel("文字色", { exact: true }).fill("#ff3300");
    await controller.getByLabel("文字の書体").selectOption("mincho");
    await controller.getByLabel("選択した文字を点滅").check();
    await controller.getByLabel("区間末尾で停止する秒数").fill("2");
    await controller.getByRole("button", { name: "選択した文字に適用" }).click();
    await expect(controller.locator(".ticker-edit-preview .ticker-blink")).toHaveCount(1);
    await controller.getByLabel("写真を追加", { exact: true }).setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png });
    await expect(controller.locator(".media-items article")).toHaveCount(1);
    expect(await controller.locator("input:invalid").evaluateAll(elements => elements.map(el => ({ name: (el as HTMLInputElement).outerHTML, message: (el as HTMLInputElement).validationMessage })))).toEqual([]);
    await controller.getByRole("button", { name: "Signageに反映して記録" }).click();
    await expect.poll(() => api.rows.get(aId)?.revision, { timeout: 15000 }).toBe(1);
    expect(api.rows.get(bId)?.revision).toBe(0);
    expect(api.rows.get(aId)?.settings.travel).toMatchObject({ mode: "gps", latitude: 35, longitude: 139, minutes: 4 });
    expect(api.rows.get(aId)?.settings.ticker?.segments[0]).toMatchObject({ text: "安全", color: "#ff3300", font: "mincho", weight: 400, blink: true, pauseSeconds: 2 });
    expect(api.uploads[0]).toContain(`/dtis-media/${owner}/image/`);
    await expect(first.locator(".signage-media img")).toBeVisible();
    await expect(first.locator(".signage-media img")).toHaveJSProperty("naturalWidth", 1);
    await expect(first.locator(".signage")).toHaveAttribute("data-font-preset", "mincho");
    await expect(second.locator(".signage-media")).toHaveCount(0);
    await controller.getByRole("button", { name: /受付.*接続中/ }).click();
    await controller.getByRole("button", { name: "デバイス設定" }).click();
    const menu = controller.getByRole("dialog", { name: "デバイス設定" });
    await expect(menu.getByLabel("操作するSignage")).toHaveCount(0);
    await menu.getByRole("button", { name: "表示を停止", exact: true }).click();
    await expect(second.getByRole("heading", { name: "表示を停止しています" })).toBeVisible();
    await expect(first.locator(".signage-media img")).toBeVisible();
    expect(api.applied).toEqual([aId, bId]);
    const bounds = await menu.boundingBox(); expect(bounds!.width).toBeGreaterThan(900); expect(bounds!.height).toBeLessThan(768);
    await controller.screenshot({ path: "artifacts/studio-ipad-settings.png" });
    await menu.getByRole("button", { name: "閉じる" }).click();
    await first.reload();
    await expect(controller.locator(".connection-notices")).toContainText("既存のSignageが再接続しました", { timeout: 12000 });
    await controller.setViewportSize({ width: 390, height: 844 });
    expect(await controller.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await controller.screenshot({ path: "artifacts/studio-mobile.png", fullPage: true });
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test("homepage and iPad WebKit load bundled Japanese fonts and expose usable navigation", async ({ browser, baseURL }) => {
  const safari = existsSync(webkit.executablePath()) ? await webkit.launch({ executablePath: webkit.executablePath() }) : null;
  const context = await (safari ?? browser).newContext({ viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" });
  const api = backend(); await api.attach(context);
  try {
    const page = await context.newPage(); await page.goto(baseURL!);
    await expect(page.locator(".hero").getByRole("link", { name: /システムを利用する/ })).toHaveAttribute("href", new URL("controller/", baseURL!).pathname);
    expect(await page.evaluate(() => [...document.querySelectorAll("body *")].filter(el => getComputedStyle(el).position !== "absolute" && el.getBoundingClientRect().right > innerWidth + 1).map(el => ({ cls: el.className, right: el.getBoundingClientRect().right })))).toEqual([]);
    await page.evaluate(async () => { await document.fonts.load('400 24px "BIZ UDPMincho"', "まち案内"); await document.fonts.load('700 24px "BIZ UDPGothic"', "日本語"); });
    expect(await page.evaluate(() => document.fonts.check('700 24px "BIZ UDPGothic"', "日本語"))).toBe(true);
    await page.screenshot({ path: "artifacts/homepage-ipad.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => [...document.querySelectorAll("body *")].filter(el => getComputedStyle(el).position !== "absolute" && el.getBoundingClientRect().right > innerWidth + 1).map(el => ({ cls: el.className, right: el.getBoundingClientRect().right })))).toEqual([]);
    await page.screenshot({ path: "artifacts/homepage-mobile.png" });
    await page.goto(`${baseURL}controller/`);
    await expect(page.getByRole("button", { name: "＋ Signageを追加" })).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain("BIZ UDPGothic");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await context.close(); await safari?.close(); }
});
