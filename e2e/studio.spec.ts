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
  const registrations: string[] = [], deletions: string[] = [];
  const faults = { deleteDenied: false, deleteNoop: false, dropDeleteResponse: false, lookupOffline: false };
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
          registrations.push(record.id);
          rows.set(record.id, record); return json(record);
        }
        const id = path.searchParams.get("id")?.replace(/^eq\./, "");
        if (request.method() === "DELETE") {
          if (faults.deleteDenied) return json({ code: "42501", message: "permission denied for table dtis_devices" }, 403);
          if (faults.deleteNoop) return json([]);
          const removed = id && rows.delete(id);
          if (removed) deletions.push(id);
          if (faults.dropDeleteResponse) return route.abort("failed");
          return json(removed ? [{ id }] : []);
        }
        if (id && faults.lookupOffline) return route.abort("failed");
        const values = id ? [...rows.values()].filter(row => row.id === id) : [...rows.values()];
        if (request.headers().accept?.includes("vnd.pgrst.object") && !values.length) return json({ code: "PGRST116", message: "Cannot coerce the result to a single JSON object", details: "The result contains 0 rows" }, 406);
        return json(request.headers().accept?.includes("vnd.pgrst.object") ? values[0] ?? null : values);
      }
      if (path.pathname === "/rest/v1/dtis_events") return json([]);
      const record = rows.get(body.p_device_id);
      if (!record) return json({ code: "42501", message: "device_not_found" }, 403);
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
  return { rows, uploads, applied, registrations, deletions, faults, attach };
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
    await first.goto(a); await expect(first.getByRole("heading", { name: "表示する路線を追加してください" })).toBeVisible();
    const b = await add("受付"), bId = new URL(b).searchParams.get("device")!;
    await second.goto(b); await expect(second.getByRole("heading", { name: "表示する路線を追加してください" })).toBeVisible();
    await expect(controller.locator(".connection-notices")).toContainText("新しいSignageが接続しました", { timeout: 12000 });
    await controller.getByRole("button", { name: /入口.*接続中/ }).click();
    await controller.getByRole("button", { name: /クイック設定/ }).click();
    await expect(controller.getByLabel("施設名", { exact: true })).toHaveCount(0);
    await expect(controller.getByLabel("書体のプリセット")).toBeEnabled();
    await expect(controller.locator(".fleet-section")).toHaveCount(0);
    await expect(controller.getByRole("navigation", { name: "Signage一覧" }).locator(".equipment-book")).toHaveCount(2);
    await controller.getByRole("button", { name: "＋ 路線を追加する" }).click();
    const routes = controller.getByRole("dialog", { name: "路線を追加", exact: true });
    await routes.getByLabel("1. 駅・停留所を検索").fill("浅草");
    await routes.getByLabel("駅・停留所の候補").getByRole("button", { name: /浅草/ }).click();
    await routes.getByLabel("路線の候補").getByRole("button", { name: "銀座線" }).click();
    await routes.getByRole("button", { name: "追加する", exact: true }).click();
    await expect(controller.locator(".route-card")).toHaveCount(1);
    await controller.getByLabel("書体のプリセット").selectOption("mincho");
    await controller.getByLabel("発車時のアニメーション").selectOption("split-flap");
    await controller.getByLabel("移動時間の設定").selectOption("gps");
    await controller.getByRole("button", { name: "このデバイスのGPSで設置場所を取得" }).click();
    await expect(controller.getByLabel("設置場所の緯度")).toHaveValue("35");
    await controller.getByLabel("推定に追加する時間（分）").fill("4");
    const ticker = controller.getByLabel("画面下部のスクロール文面");
    await controller.getByLabel("文字の大きさ", { exact: true }).selectOption("large");
    await controller.getByLabel("スクロール速度", { exact: true }).selectOption("40");
    // Deleting the first of two identical characters must retain the second's styling.
    await ticker.fill("ああ");
    await ticker.press("Home"); await ticker.press("Shift+ArrowRight");
    await controller.getByLabel("文字色", { exact: true }).fill("#ff0000");
    await controller.getByRole("button", { name: "選択した文字に適用", exact: true }).click();
    await ticker.press("Control+End"); await ticker.press("Shift+ArrowLeft");
    await controller.getByLabel("文字色", { exact: true }).fill("#0000ff");
    await controller.getByRole("button", { name: "選択した文字に適用", exact: true }).click();
    await ticker.press("Home"); await ticker.press("Shift+ArrowRight"); await ticker.press("Backspace");
    await expect(ticker).toHaveText("あ");
    await expect(ticker.locator("span")).toHaveCSS("color", "rgb(0, 0, 255)");
    await controller.getByRole("button", { name: "元に戻す", exact: true }).click();
    await expect(ticker).toHaveText("ああ");
    await controller.getByRole("button", { name: "文字の装飾をすべて解除", exact: true }).click();
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
    await ticker.press("Control+End");
    await ticker.pressSequentially("。", { delay: 20 });
    await expect(ticker).toHaveText("安全にお進みください。");
    await expect(controller.locator(".ticker-edit-preview .ticker-blink")).toHaveCount(1);
    await controller.getByRole("button", { name: "元に戻す", exact: true }).click();
    await expect(ticker).toHaveText("安全にお進みください");
    await controller.getByRole("button", { name: "やり直す", exact: true }).click();
    await expect(ticker).toHaveText("安全にお進みください。");
    await controller.getByLabel("写真を追加", { exact: true }).setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png });
    await expect(controller.locator(".media-items article")).toHaveCount(1);
    expect(await controller.locator("input:invalid").evaluateAll(elements => elements.map(el => ({ name: (el as HTMLInputElement).outerHTML, message: (el as HTMLInputElement).validationMessage })))).toEqual([]);
    await controller.getByRole("button", { name: "保存", exact: true }).click();
    await expect.poll(() => api.rows.get(aId)?.revision, { timeout: 15000 }).toBe(1);
    expect(api.rows.get(bId)?.revision).toBe(0);
    expect(api.rows.get(aId)?.settings.travel).toMatchObject({ mode: "gps", latitude: 35, longitude: 139, minutes: 4 });
    expect(api.rows.get(aId)?.settings.ticker?.segments[0]).toMatchObject({ text: "安全", color: "#ff3300", font: "mincho", weight: 400, blink: true, pauseSeconds: 2 });
    expect(api.rows.get(aId)?.settings.ticker).toMatchObject({ size: "large", speed: 40 });
    expect(api.uploads[0]).toContain(`/dtis-media/${owner}/image/`);
    await expect(first.locator(".signage-media img")).toBeVisible();
    await expect(first.locator(".signage-media img")).toHaveJSProperty("naturalWidth", 1);
    await expect(first.locator(".signage")).toHaveAttribute("data-font-preset", "mincho");
    await expect(second.locator(".signage-media")).toHaveCount(0);
    await expect(first.locator(".app-facility")).toContainText("浅草");
    for (let repeat = 0; repeat < 4; repeat++) {
      await controller.getByRole("button", { name: /受付.*接続中/ }).click();
      await expect(controller.locator(".route-card")).toHaveCount(0);
      await expect(controller.getByLabel("文字の大きさ", { exact: true })).toHaveValue("medium");
      await controller.getByRole("button", { name: /入口.*接続中/ }).click();
      await expect(controller.locator(".route-card")).toHaveCount(1);
      await expect(controller.locator("dialog.route-dialog")).toHaveCount(2);
      await expect(controller.getByLabel("文字の大きさ", { exact: true })).toHaveValue("large");
    }
    await controller.getByRole("button", { name: /受付.*接続中/ }).click();
    const menu = controller.getByRole("region", { name: "デバイス設定" });
    await expect(menu.getByLabel("操作するSignage")).toHaveCount(0);
    await menu.getByRole("button", { name: "表示を停止", exact: true }).click();
    await expect(second.getByRole("heading", { name: "表示を停止しています" })).toBeVisible();
    await expect(first.locator(".signage-media img")).toBeVisible();
    expect(api.applied).toEqual([aId, bId]);
    const bounds = await menu.boundingBox(); expect(bounds!.width).toBeGreaterThan(900);
    await controller.screenshot({ path: "artifacts/studio-ipad-settings.png" });
    await first.reload();
    await expect(controller.locator(".connection-notices")).toContainText("既存のSignageが再接続しました", { timeout: 12000 });
    await controller.setViewportSize({ width: 390, height: 844 });
    expect(await controller.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await controller.screenshot({ path: "artifacts/studio-mobile.png", fullPage: true });
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test("Controller grid edits, delayed times, suspension, and independent animations persist to the actual Signage", async ({ browser, baseURL }) => {
  test.setTimeout(120000);
  const api = backend(), context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await api.attach(context);
  const errors: string[] = []; context.on("page", page => page.on("pageerror", e => errors.push(e.message)));
  const controller = await context.newPage(), signage = await context.newPage();
  try {
    await controller.goto(`${baseURL}controller/`);
    await controller.getByRole("button", { name: "＋ Signageを追加" }).click();
    const add = controller.getByRole("dialog", { name: "Signageを追加", exact: true });
    await add.getByLabel("デバイス名", { exact: true }).fill("住吉の案内");
    await add.getByRole("button", { name: "追加する", exact: true }).click();
    const address = await add.getByLabel("専用URL", { exact: true }).inputValue(), id = new URL(address).searchParams.get("device")!;
    await add.getByRole("button", { name: "閉じる" }).click();
    await signage.goto(address);
    await expect(signage.getByRole("heading", { name: "表示する路線を追加してください" })).toBeVisible();
    await expect(controller.locator(".equipment-controller")).toHaveCSS("background-color", "rgb(200, 200, 200)");
    await expect(controller.locator(".book-settings")).toHaveCount(0);
    await expect(controller.getByRole("heading", { name: /今の様子/ })).toBeVisible();
    await controller.screenshot({ path: "artifacts/controller-home-desktop.png", fullPage: true, animations: "disabled" });
    await controller.getByRole("button", { name: /クイック設定/ }).click();
    await controller.getByRole("button", { name: "＋ 路線を追加する" }).click();
    const routes = controller.getByRole("dialog", { name: "路線を追加", exact: true });
    await routes.getByLabel("1. 駅・停留所を検索").fill("浅草");
    await routes.getByLabel("駅・停留所の候補").getByRole("button", { name: /浅草/ }).click();
    await routes.getByLabel("路線の候補").getByRole("button", { name: "銀座線" }).click();
    await routes.getByRole("button", { name: "追加する", exact: true }).click();
    await controller.getByLabel("運行状況", { exact: true }).selectOption("delayed");
    await controller.getByLabel("遅れ時分（分）").fill("7");
    await controller.getByLabel("運行案内文").fill("安全確認のため遅れています");
    await controller.getByLabel("発車時のアニメーション").selectOption("slide");
    await controller.getByLabel("画面切り替えのトランジション").selectOption("zoom");
    await controller.getByLabel("画面下部のスクロール文面").fill("足元にご注意ください");
    await controller.getByRole("button", { name: "保存", exact: true }).click();
    await expect.poll(() => api.rows.get(id)?.revision).toBe(1);
    await expect(signage.locator("time.departure-delayed")).toContainText("00:22");
    await expect(signage.locator("time.departure-delayed small")).toHaveText("定刻 24:15 ＋7分");
    await expect(signage.locator("time.departure-delayed")).toHaveCSS("color", "rgb(255, 224, 75)");
    await expect(signage.locator(".departure-list")).toHaveAttribute("data-departure-animation", "slide");
    await expect(signage.locator(".departure-pages")).toHaveAttribute("data-page-transition", "zoom");
    await signage.screenshot({ path: "artifacts/signage-delayed.png", fullPage: true, animations: "disabled" });
    await controller.getByRole("button", { name: "トップ", exact: true }).click();
    await controller.getByRole("button", { name: /エディターで/ }).click();
    const canvas = controller.getByLabel("Signageの編集キャンバス");
    await expect(canvas.locator(".route-name h2")).toContainText("銀座線");
    await canvas.locator(".route-name h2").click();
    await controller.getByLabel("表示テキスト", { exact: true }).fill("東京メトロ銀座線");
    await controller.getByLabel("文字色", { exact: true }).fill("#b794ff");
    await expect(canvas.locator(".route-name h2")).toHaveCSS("color", "rgb(183, 148, 255)");
    await controller.getByRole("button", { name: "＋ テキスト", exact: true }).click();
    await controller.getByLabel("テキスト", { exact: true }).fill("お乗り遅れにご注意ください");
    await controller.getByLabel("文字サイズ", { exact: true }).fill("64");
    await controller.getByLabel("点滅", { exact: true }).check();
    const position = controller.locator(".part-geometry");
    await position.getByText("位置と大きさ", { exact: true }).click();
    await position.getByLabel("左から（%）").fill("10"); await position.getByLabel("上から（%）").fill("60");
    const part = canvas.locator(".editor-part.is-selected");
    await part.focus(); await part.press("ArrowRight");
    await expect(position.getByLabel("左から（%）")).toHaveValue("12");
    const before = (await part.boundingBox())!, bounds = (await canvas.boundingBox())!;
    await controller.mouse.move(before.x + 20, before.y + 20); await controller.mouse.down();
    await controller.mouse.move(before.x + 20 + bounds.width * .04, before.y + 20, { steps: 4 }); await controller.mouse.up();
    await expect(position.getByLabel("左から（%）")).toHaveValue("16");
    const handle = (await part.getByLabel("パーツの大きさを変更").boundingBox())!;
    await controller.mouse.move(handle.x + 8, handle.y + 8); await controller.mouse.down();
    await controller.mouse.move(handle.x + 8 + bounds.width * .04, handle.y + 8, { steps: 4 }); await controller.mouse.up();
    await expect(position.getByLabel("幅（%）")).toHaveValue("44");
    await controller.locator(".layout-history").getByRole("button", { name: "元に戻す", exact: true }).click();
    await expect(position.getByLabel("幅（%）")).toHaveValue("40");
    await controller.locator(".layout-history").getByRole("button", { name: "やり直す", exact: true }).click();
    await expect(position.getByLabel("幅（%）")).toHaveValue("44");
    await controller.getByRole("button", { name: "複製", exact: true }).click();
    await expect(canvas.locator(".editor-part")).toHaveCount(4);
    await controller.getByRole("button", { name: "削除", exact: true }).click();
    await expect(canvas.locator(".editor-part")).toHaveCount(3);
    await controller.getByRole("button", { name: "保存", exact: true }).click();
    await expect.poll(() => api.rows.get(id)?.revision).toBe(2);
    await expect(signage.locator(".signage-layout-part")).toHaveCount(3);
    await expect(signage.locator(".route-name h2")).toHaveText("東京メトロ銀座線");
    await expect(signage.locator(".signage-part-text")).toHaveText("お乗り遅れにご注意ください");
    await expect(signage.locator(".signage-part-text")).toHaveClass(/ticker-blink/);
    await expect(signage.locator(".rich-ticker")).toHaveCount(1);
    await controller.locator(".palette-layers summary").click();
    await controller.locator(".part-layers button").last().click();
    await expect(controller.getByRole("region", { name: "選択したパーツの編集" })).toBeVisible();
    await controller.screenshot({ path: "artifacts/controller-editor-desktop.png", fullPage: true, animations: "disabled" });
    await signage.screenshot({ path: "artifacts/signage-layout-custom.png", fullPage: true, animations: "disabled" });
    await controller.reload();
    await controller.getByRole("button", { name: /エディターで/ }).click();
    await expect(canvas.locator(".editor-part")).toHaveCount(3);
    await expect(controller.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
    for (const width of [820, 390, 320]) {
      await controller.setViewportSize({ width, height: 900 });
      expect(await controller.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const metrics = await canvas.locator(".route-heading").evaluate(el => {
        const line = el.querySelector(".route-name")!.getBoundingClientRect(), direction = el.querySelector(".direction-name")!.getBoundingClientRect();
        return { lineTop: line.top, directionTop: direction.top, lineBottom: line.bottom, directionBottom: direction.bottom };
      });
      expect(metrics.directionTop).toBeLessThan(metrics.lineBottom);
      expect(metrics.lineTop).toBeLessThan(metrics.directionBottom);
      await controller.screenshot({ path: `artifacts/controller-editor-${width}.png`, fullPage: true, animations: "disabled" });
    }
    await controller.getByRole("button", { name: "トップ", exact: true }).click();
    await controller.getByRole("button", { name: /クイック設定/ }).click();
    await controller.getByLabel("運行状況", { exact: true }).selectOption("suspended");
    await controller.getByLabel("運行案内文").fill("運転再開は未定です");
    await controller.getByRole("button", { name: "保存", exact: true }).click();
    await expect.poll(() => api.rows.get(id)?.revision).toBe(3);
    await expect(signage.locator(".service-suspended")).toContainText("運転見合わせ");
    await expect(signage.locator(".departure-list")).toHaveCount(0);
    await controller.screenshot({ path: "artifacts/controller-quick-mobile.png", fullPage: true, animations: "disabled" });
    await signage.screenshot({ path: "artifacts/signage-suspended.png", fullPage: true, animations: "disabled" });
    await controller.getByLabel("運行状況", { exact: true }).selectOption("normal");
    await controller.getByRole("button", { name: "保存", exact: true }).click();
    await expect.poll(() => api.rows.get(id)?.revision).toBe(4);
    await expect(signage.locator(".service-suspended,.service-message,time.departure-delayed")).toHaveCount(0);
    await expect(signage.locator(".departure-list article")).toHaveCount(1);
    await signage.emulateMedia({ reducedMotion: "reduce" });
    await expect(signage.locator(".signage-part-text")).toHaveCSS("animation-name", "none");
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

test("offline Signages can be removed with cancellation, permission failures, and last-device cleanup", async ({ browser, baseURL }) => {
  const api = backend(), context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await api.attach(context);
  const errors: string[] = []; context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
  const page = await context.newPage();
  try {
    await page.goto(`${baseURL}controller/`);
    async function add(name: string) {
      await page.getByRole("button", { name: "＋ Signageを追加" }).click();
      const dialog = page.getByRole("dialog", { name: "Signageを追加", exact: true });
      await dialog.getByLabel("デバイス名", { exact: true }).fill(name);
      await dialog.getByRole("button", { name: "追加する", exact: true }).click();
      const address = await dialog.getByLabel("専用URL", { exact: true }).inputValue();
      await dialog.getByRole("button", { name: "閉じる" }).click();
      return new URL(address).searchParams.get("device")!;
    }
    const a = await add("残す端末"), b = await add("削除する端末");
    const preserved = structuredClone(api.rows.get(a));
    const shelf = page.getByRole("navigation", { name: "Signage一覧" });
    await page.getByRole("button", { name: /クイック設定/ }).click();
    const remove = page.getByRole("button", { name: "このSignageを削除", exact: true });
    await expect(remove).toBeEnabled();
    await remove.click();
    const dialog = page.getByRole("dialog", { name: "Signageを削除", exact: true });
    await expect(dialog).toContainText("削除する端末");
    await expect(dialog).toContainText("設定と操作履歴");
    expect(await dialog.evaluate(el => el.getBoundingClientRect().right <= innerWidth && el.getBoundingClientRect().left >= 0)).toBe(true);
    await page.screenshot({ path: "artifacts/delete-signage-mobile.png" });
    await dialog.getByRole("button", { name: "キャンセル", exact: true }).click();
    expect(api.deletions).toEqual([]); expect(api.rows.size).toBe(2);
    await remove.click(); await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible();
    api.faults.deleteDenied = true;
    await remove.click(); await dialog.getByRole("button", { name: "削除する", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("削除権限がありません");
    expect(api.rows.size).toBe(2); await expect(shelf.locator(".equipment-book")).toHaveCount(2);
    api.faults.deleteDenied = false; api.faults.deleteNoop = true;
    await dialog.getByRole("button", { name: "削除する", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Signageを削除できませんでした");
    expect(api.rows.size).toBe(2);
    api.faults.deleteNoop = false;
    await dialog.getByRole("button", { name: "削除する", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(shelf.locator(".equipment-book")).toHaveCount(1);
    await expect(shelf.getByRole("button", { name: /残す端末.*接続待ち/ })).toHaveAttribute("aria-pressed", "true");
    expect(api.rows.has(b)).toBe(false); expect(api.rows.get(a)).toEqual(preserved);
    await page.getByRole("button", { name: /クイック設定/ }).click();
    await remove.click();
    // A committed DELETE with a lost HTTP response is reconciled by a read.
    api.faults.dropDeleteResponse = true;
    await dialog.getByRole("button", { name: "削除する", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("heading", { name: "Signageを開いてください" })).toBeVisible();
    await expect(shelf.locator(".equipment-book")).toHaveCount(0);
    expect(api.rows.size).toBe(0); expect(api.deletions).toEqual([b, a]);
    await page.reload(); await expect(shelf.locator(".equipment-book")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test("deletion clears a running Signage and its cache without recreating known browser IDs or explicit URLs", async ({ browser, baseURL }) => {
  const api = backend(), context = await browser.newContext(); await api.attach(context);
  const errors: string[] = []; context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
  const signage = await context.newPage(), controller = await context.newPage();
  try {
    await signage.goto(`${baseURL}signage/`);
    await expect(signage.getByRole("heading", { name: "表示する路線を追加してください" })).toBeVisible();
    await expect.poll(() => api.rows.size).toBe(1);
    const id = [...api.rows.keys()][0];
    await controller.goto(`${baseURL}controller/`);
    await controller.getByRole("button", { name: /クイック設定/ }).click();
    const ticker = controller.getByLabel("画面下部のスクロール文面");
    await expect(ticker).toBeEnabled(); await ticker.fill("未保存の文面");
    await controller.getByRole("button", { name: "このSignageを削除", exact: true }).click();
    const dialog = controller.getByRole("dialog", { name: "Signageを削除", exact: true });
    await expect(dialog).toContainText("未保存の変更も破棄されます");
    await dialog.getByRole("button", { name: "キャンセル", exact: true }).click();
    await expect(ticker).toHaveText("未保存の文面"); expect(api.deletions).toEqual([]);
    // Network failure retains the existing display rather than marking it deleted.
    api.faults.lookupOffline = true;
    await expect(signage.locator(".signage-connection-error")).toContainText("現在の表示を継続", { timeout: 15000 });
    await expect(signage.getByRole("heading", { name: "表示する路線を追加してください" })).toBeVisible();
    api.faults.lookupOffline = false;
    await controller.getByRole("button", { name: "このSignageを削除", exact: true }).click();
    await dialog.getByRole("button", { name: "削除する", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(signage.getByRole("heading", { name: "このSignageは利用できません" })).toBeVisible({ timeout: 15000 });
    await expect(signage.locator(".signage-parts-stage")).toHaveCount(0);
    expect(await signage.evaluate(id => localStorage.getItem(`d-tis.signage.applied.${id}`), id)).toBeNull();
    await signage.screenshot({ path: "artifacts/deleted-signage.png" });
    const registrationCount = api.registrations.length;
    await signage.reload();
    await expect(signage.getByRole("heading", { name: "このSignageは利用できません" })).toBeVisible();
    await signage.goto(`${baseURL}signage/?device=${id}`);
    await expect(signage.getByRole("heading", { name: "このSignageは利用できません" })).toBeVisible();
    expect(api.registrations.length).toBe(registrationCount); expect(api.rows.size).toBe(0);
    await controller.reload();
    await expect(controller.getByRole("navigation", { name: "Signage一覧" }).locator(".equipment-book")).toHaveCount(0);
    await controller.getByRole("button", { name: "＋ Signageを追加" }).click();
    const addDialog = controller.getByRole("dialog", { name: "Signageを追加", exact: true });
    await addDialog.getByLabel("デバイス名", { exact: true }).fill("新しい端末");
    await addDialog.getByRole("button", { name: "追加する", exact: true }).click();
    const newAddress = await addDialog.getByLabel("専用URL", { exact: true }).inputValue();
    await addDialog.getByRole("button", { name: "閉じる" }).click();
    await signage.goto(newAddress);
    await expect(signage.getByRole("heading", { name: "表示する路線を追加してください" })).toBeVisible();
    expect(api.rows.size).toBe(1); expect(api.rows.has(id)).toBe(false);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
