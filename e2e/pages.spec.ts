import { test, expect, type BrowserContext, type Page, type WebSocketRoute } from "@playwright/test";
import { Buffer } from "node:buffer";

const SUPABASE = "http://127.0.0.1:54321";
const owner = "10000000-0000-4000-8000-000000000001";
const deviceId = "20000000-0000-4000-8000-000000000002";
const user = { id: owner, aud: "authenticated", role: "authenticated", email: "operator@example.test", email_confirmed_at: "2026-01-01T00:00:00Z", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const jwt = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: owner, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.local-test-signature`;

function packet(message: string | Buffer) {
  if (typeof message === "string") {
    const [joinRef, ref, topic, event, payload] = JSON.parse(message);
    return { joinRef, ref, topic, event, payload };
  }
  // Supabase-js >=2.119 encodes outgoing JSON broadcasts with binary framing.
  expect(message[0]).toBe(3);
  const sizes = [...message.subarray(1, 6)];
  let offset = 7;
  const fields = sizes.map(size => { const value = message.subarray(offset, offset + size).toString("utf8"); offset += size; return value; });
  return { joinRef: fields[0], ref: fields[1], topic: fields[2], event: "broadcast", payload: { event: fields[3], payload: JSON.parse(message.subarray(offset).toString("utf8")) } };
}

async function login(page: Page, product: string) {
  await page.goto(product);
  await page.getByLabel("メールアドレス").fill("operator@example.test");
  await page.getByLabel("パスワード", { exact: true }).fill("local-test-password");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
}

test("all static entrypoints, stylesheet fonts, and shared images respect the Pages repository path", async ({ request, baseURL }) => {
  const assets = new Set<string>();
  for (const app of ["", "signage/", "controller/"]) {
    const response = await request.get(`${baseURL}${app}`); expect(response.status()).toBe(200);
    const html = await response.text();
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const url = new URL(match[1], response.url()).href;
      expect(url.startsWith(baseURL!)).toBe(true); assets.add(url);
    }
  }
  for (const suffix of ["logo.svg", "hero.svg", "assets/Logo/1.svg", "assets/unknown.svg", "assets/Hokuso_Line/HS.PNG"]) assets.add(`${baseURL}${suffix}`);
  const fonts = new Set<string>();
  for (const url of assets) {
    const response = await request.get(url); expect(response.status(), url).toBe(200);
    if (url.endsWith(".css")) for (const match of (await response.text()).matchAll(/url\(["']?([^\)"']+)/g)) {
      if (match[1].startsWith("data:")) continue;
      const asset = new URL(match[1], url).href; expect(asset.startsWith(baseURL!)).toBe(true); fonts.add(asset);
    }
  }
  for (const url of fonts) expect((await request.get(url)).status(), url).toBe(200);
  expect(fonts.size).toBeGreaterThan(30);
  expect((await request.get(`${baseURL}not-a-route/`)).status()).toBe(404);
});

test("static Pages applications apply, paint, commit, requery, and relay the actual Signage image", async ({ browser, baseURL }) => {
  const browserErrors: string[] = [];
  const joins: boolean[] = [];
  const sockets = new Set<{ ws: WebSocketRoute; topics: Set<string> }>();
  const commits: { source: string; action: string; rendered: string; paused: boolean }[] = [];
  let controllerReadsAfterCommit = 0;
  let rejectNextCommit = false;
  let loseNextCommitResponse = false;
  const reconciliations: string[] = [];
  let signage: Page;
  let record = { id: deviceId, owner_id: owner, name: "試験用Signage", revision: 0, refresh_version: 0, display_enabled: true, last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString(), settings: { facilityName: "初期表示", directionDisplayMode: "separate", selectedRoutes: [], tickerText: "", updatedAt: "", devices: [{ id: "primary", code: "LCD-01", name: "メイン画面", type: "lcd", enabled: true }] } };
  const history: object[] = [];

  async function mock(context: BrowserContext, source: string) {
    await context.addInitScript(({ url, owner, deviceId, role }) => {
      if (location.origin === "null") return;
      localStorage.setItem("d-tis.cloud.config.v1", JSON.stringify({ url, key: "sb_publishable_local_test" }));
      localStorage.setItem("d-tis.odpt.config.v1", JSON.stringify({ token: "", gtfsUrls: [] }));
      localStorage.setItem(`d-tis.signage.id.${url}.${owner}`, deviceId);
      // Supply deterministic local video without opening an OS screen picker.
      // RTCPeerConnection, signaling, ICE and media playback stay real.
      if (role === "signage" && navigator.mediaDevices) {
        Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", { configurable: true, value: async () => {
          const canvas = document.createElement("canvas"); canvas.width = 960; canvas.height = 540;
          const ctx = canvas.getContext("2d")!; let frame = 0;
          const draw = () => { ctx.fillStyle = "#193b42"; ctx.fillRect(0, 0, 960, 540); ctx.fillStyle = "white"; ctx.font = "40px sans-serif"; ctx.fillText(`WEBRTC LOCAL TEST ${frame++}`, 50, 280); };
          draw(); setInterval(draw, 100); return canvas.captureStream(10);
        } });
      }
      const RealPeerConnection = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends RealPeerConnection {
        constructor(config?: RTCConfiguration) { super({ ...config, iceServers: [] }); }
      };
    }, { url: SUPABASE, owner, deviceId, role: source });
    context.on("page", page => page.on("pageerror", error => browserErrors.push(`${source}: ${error.message}`)));
    await context.route(`${SUPABASE}/**`, async route => {
      const request = route.request(), url = new URL(request.url());
      const json = async (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" }, body: JSON.stringify(data) });
      if (request.method() === "OPTIONS") { await json(null); return; }
      if (url.pathname === "/auth/v1/token") { await json({ access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "local-refresh-token", user }); return; }
      if (url.pathname === "/auth/v1/user") { await json(user); return; }
      if (url.pathname === "/rest/v1/dtis_devices") {
        if (source === "controller" && commits.length) controllerReadsAfterCommit++;
        await json(request.headers().accept?.includes("vnd.pgrst.object+json") ? record : [record]); return;
      }
      if (url.pathname === "/rest/v1/dtis_events") { await json(history); return; }
      if (url.pathname === "/rest/v1/rpc/dtis_heartbeat") { record.last_seen_at = new Date().toISOString(); await json(null); return; }
      if (url.pathname === "/rest/v1/rpc/dtis_reconcile_applied") {
        const body = request.postDataJSON();
        const committed = history.some(value => (value as { command_id: string }).command_id === body.p_command_id);
        const status = committed ? "committed" : record.revision !== body.p_expected_revision ? "rejected" : "pending";
        reconciliations.push(status); await json({ status, device: record }); return;
      }
      if (url.pathname === "/rest/v1/rpc/dtis_commit_applied") {
        const body = request.postDataJSON();
        const snapshot = await signage.locator(".signage").evaluate(element => ({ rendered: element.textContent || "", paused: element.classList.contains("signage-paused") }));
        commits.push({ source, action: body.p_action, ...snapshot });
        if (rejectNextCommit) { rejectNextCommit = false; await json({ code: "40001", message: "revision_conflict" }, 409); return; }
        expect(body.p_expected_revision).toBe(record.revision);
        record = { ...record, settings: body.p_settings, display_enabled: body.p_display_enabled, refresh_version: body.p_refresh_version, revision: record.revision + 1, updated_at: new Date().toISOString() };
        history.unshift({ id: crypto.randomUUID(), device_id: deviceId, command_id: body.p_command_id, action: body.p_action, revision: record.revision, applied_at: body.p_applied_at, created_at: record.updated_at });
        if (loseNextCommitResponse) { loseNextCommitResponse = false; await route.abort("failed"); return; }
        await json(record); return;
      }
      throw new Error(`Unexpected mocked Supabase request: ${request.method()} ${url.pathname}`);
    });
    await context.routeWebSocket(`${SUPABASE.replace("http", "ws")}/realtime/v1/websocket**`, ws => {
      const client = { ws, topics: new Set<string>() }; sockets.add(client);
      ws.onClose(() => sockets.delete(client));
      ws.onMessage(raw => {
        const message = packet(raw);
        const reply = (response = {}) => ws.send(JSON.stringify([message.joinRef, message.ref, message.topic, "phx_reply", { status: "ok", response }]));
        if (message.event === "phx_join") { joins.push(message.payload.config.private === true); client.topics.add(message.topic); reply(); return; }
        if (message.event === "phx_leave") { client.topics.delete(message.topic); reply(); return; }
        if (message.event === "broadcast") {
          reply();
          for (const other of sockets) if (other !== client && other.topics.has(message.topic)) {
            other.ws.send(JSON.stringify([null, null, message.topic, "broadcast", { type: "broadcast", ...message.payload }]));
          }
          return;
        }
        if (message.event === "heartbeat" || message.event === "access_token") reply();
      });
    });
  }

  const signageContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const controllerContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await mock(signageContext, "signage"); await mock(controllerContext, "controller");
  signage = await signageContext.newPage();
  const controller = await controllerContext.newPage();
  try {
    await login(signage, `${baseURL}signage/`);
    await expect(signage.locator(".app-facility")).toContainText("初期表示");
    await login(controller, `${baseURL}controller/`);
    await expect(controller.getByLabel("施設名", { exact: true })).toBeEnabled();
    await expect(controller.getByRole("img", { name: /Signageが送信した画面/ })).toBeVisible({ timeout: 20000 });
    expect(joins.length).toBeGreaterThanOrEqual(2); expect(joins.every(Boolean)).toBe(true);

    await controller.getByLabel("施設名", { exact: true }).fill("描画後に記録する駅");
    await controller.getByLabel("画面下部のスクロール文面").fill("足元にご注意ください");
    await controller.getByRole("button", { name: "Signageに反映して記録" }).click();
    await expect(controller.locator(".cloud-sync")).toContainText("確定リビジョン 1");
    await expect(signage.locator(".app-facility")).toContainText("描画後に記録する駅");
    expect(commits[0].source).toBe("signage"); expect(commits[0].rendered).toContain("描画後に記録する駅");
    expect(commits[0].rendered).toContain("足元にご注意ください"); expect(controllerReadsAfterCommit).toBeGreaterThan(0);
    expect(history).toHaveLength(1);

    await controller.getByRole("button", { name: "表示を停止", exact: true }).click();
    await expect(controller.locator(".cloud-sync")).toContainText("確定リビジョン 2");
    await expect(signage.getByRole("heading", { name: "表示を停止しています" })).toBeVisible();
    expect(commits[1]).toMatchObject({ source: "signage", action: "display", paused: true });
    await controller.getByRole("button", { name: "表示を再開", exact: true }).click();
    await expect(controller.locator(".cloud-sync")).toContainText("確定リビジョン 3");
    await expect(signage.locator(".app-facility")).toContainText("描画後に記録する駅");

    rejectNextCommit = true;
    await controller.getByLabel("施設名", { exact: true }).fill("記録に失敗する変更");
    await controller.getByRole("button", { name: "Signageに反映して記録" }).click();
    await expect(controller.locator(".feedback[role=status]")).toContainText("最新の設定を読み直してください");
    await expect(signage.locator(".app-facility")).toContainText("描画後に記録する駅");
    expect(record.revision).toBe(3); expect(history).toHaveLength(3);
    expect(commits[3].rendered).toContain("記録に失敗する変更");

    controller.on("dialog", dialog => dialog.accept());
    await controller.getByRole("button", { name: "Supabaseから再読込" }).click();
    await expect(controller.getByLabel("施設名", { exact: true })).toHaveValue("描画後に記録する駅");
    await controller.reload();
    await expect(controller.getByLabel("施設名", { exact: true })).toHaveValue("描画後に記録する駅");
    await controller.getByRole("button", { name: "両画面の交通情報を更新" }).click();
    await expect(controller.locator(".cloud-sync")).toContainText("確定リビジョン 4");
    expect(record.refresh_version).toBe(1); expect(history).toHaveLength(4);
    expect(commits[4]).toMatchObject({ source: "signage", action: "refresh", paused: false });
    // The database applied the operation but the HTTP response never arrived.
    // Signage must reconcile the exact command rather than restore stale state.
    loseNextCommitResponse = true;
    await controller.getByLabel("施設名", { exact: true }).fill("応答が失われても確定した駅");
    await controller.getByRole("button", { name: "Signageに反映して記録" }).click();
    await expect(controller.locator(".cloud-sync")).toContainText("確定リビジョン 5");
    await expect(signage.locator(".app-facility")).toContainText("応答が失われても確定した駅");
    await expect(controller.getByLabel("施設名", { exact: true })).toHaveValue("応答が失われても確定した駅");
    expect(history).toHaveLength(5); expect(reconciliations).toContain("committed");
    await expect(controller.getByRole("img", { name: /Signageが送信した画面/ })).toBeVisible({ timeout: 20000 });
    await expect(controller.getByRole("img", { name: /Signageが送信した画面/ })).toHaveJSProperty("naturalWidth", 1120);
    await signage.getByRole("button", { name: "映像で画面を共有" }).click();
    const sharedVideo = controller.getByLabel("Signageの共有映像");
    await expect(sharedVideo).toBeVisible({ timeout: 15000 });
    await expect.poll(() => sharedVideo.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBeGreaterThan(0);
    await expect.poll(() => sharedVideo.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
    await expect(controller.getByText("映像で接続中", { exact: true })).toBeVisible();
    await signage.getByRole("button", { name: "画面共有を停止" }).click();
    await expect(sharedVideo).toHaveCount(0);
    await expect(controller.getByRole("img", { name: /Signageが送信した画面/ })).toBeVisible();
    expect(browserErrors).toEqual([]);
    await signage.screenshot({ path: "artifacts/pages-signage.png", fullPage: true });
    await controller.screenshot({ path: "artifacts/pages-controller.png", fullPage: true });
    await controller.setViewportSize({ width: 390, height: 844 });
    expect(await controller.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await controller.screenshot({ path: "artifacts/pages-controller-mobile.png", fullPage: true });
  } finally { await signageContext.close(); await controllerContext.close(); }
});
