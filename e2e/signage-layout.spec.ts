import { test, expect, type BrowserContext } from "@playwright/test";
import { DEFAULT_CLOUD_CONFIG } from "../shared/public-config";
import type { DeviceRecord } from "../shared/cloud";
import type { TickerSize } from "../shared/display-settings";
import { odptFixture } from "./odpt-fixture";
import { initialLayout } from "../shared/signage-layout";

const cloud = DEFAULT_CLOUD_CONFIG.url;
const owner = "30000000-0000-4000-8000-000000000001";
const deviceId = "30000000-0000-4000-8000-000000000002";
const user = { id: owner, aud: "authenticated", role: "authenticated", email: "layout@example.test", app_metadata: {}, user_metadata: {} };
const token = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: owner, role: "authenticated", exp: 2000000000 })).toString("base64url")}.fixture`;
const selected = { railway: "odpt.Railway:TokyoMetro.Ginza", station: "odpt.Station:TokyoMetro.Ginza.Asakusa", direction: "odpt.RailDirection:Outbound" };

async function mockDisplay(context: BrowserContext, combined: boolean) {
  const record: DeviceRecord = { id: deviceId, owner_id: owner, name: "メイン画面", revision: 0, refresh_version: 0,
    display_enabled: true, last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    settings: { facilityName: "表示しない旧施設名", directionDisplayMode: combined ? "combined" : "separate",
      selectedRoutes: combined ? [selected, { ...selected, direction: "odpt.RailDirection:Inbound" }] : [selected],
      tickerText: "駅の案内です。gyp 下端まで読みやすく表示します。", ticker: { speed: 70, size: "medium", segments: [{ id: "notice", text: "駅の案内です。gyp 下端まで読みやすく表示します。" }] },
      mediaLayout: "alongside", media: [{ id: "photo", kind: "image", url: "https://layout.example.test/photo.svg", alt: "街の案内", durationSeconds: 15 }],
      updatedAt: "", devices: [{ id: "primary", code: "LCD-01", name: "メイン画面", type: "lcd", enabled: true }] } };
  await context.addInitScript(({ cloud, token, user }) => {
    if (location.origin === "null") return;
    localStorage.setItem(`sb-${new URL(cloud).hostname.split(".")[0]}-auth-token`, JSON.stringify({ access_token: token, refresh_token: "fixture", token_type: "bearer", expires_at: 2000000000, expires_in: 3600, user }));
  }, { cloud, token, user });
  await context.route("https://layout.example.test/**", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#33294a"/><circle cx="300" cy="350" r="160" fill="#8873bd"/><text x="300" y="620" text-anchor="middle" fill="white" font-size="48">D-TIS</text></svg>' }));
  await context.route("https://api.odpt.org/**", route => {
    const address = new URL(route.request().url());
    let rows = odptFixture(address);
    if (address.pathname.endsWith("odpt:StationTimetable")) {
      rows = (rows as Record<string, unknown>[]).flatMap(row => ["Outbound", "Inbound"].map(direction => ({ ...row,
        "owl:sameAs": `${row["owl:sameAs"]}.${direction}`, "odpt:railDirection": `odpt.RailDirection:${direction}`,
        "odpt:stationTimetableObject": ["24:15", "24:20"].map(time => ({ "odpt:departureTime": time, "odpt:destinationStation": [selected.station], "odpt:trainType": "odpt.TrainType:TokyoMetro.Local" })) })));
    }
    return route.fulfill({ json: rows });
  });
  await context.route(`${cloud}/**`, route => {
    const pathname = new URL(route.request().url()).pathname;
    return route.fulfill({ json: pathname === "/auth/v1/user" ? user : pathname.endsWith("dtis_heartbeat") ? null : record });
  });
  await context.routeWebSocket(`${cloud.replace("http", "ws")}/realtime/v1/websocket**`, ws => {
    ws.onMessage(raw => {
      if (typeof raw !== "string") return;
      const [join, ref, topic] = JSON.parse(raw);
      ws.send(JSON.stringify([join, ref, topic, "phx_reply", { status: "ok", response: {} }]));
    });
  });
  return record;
}

test("custom-layout media and scrolling text keep playing through language changes", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const record = await mockDisplay(context, false);
  record.settings.media!.push({ ...record.settings.media![0], id: "second", alt: "2枚目の写真", url: "https://layout.example.test/second.svg" });
  record.settings.layout = initialLayout(record.settings);
  const page = await context.newPage();
  await page.clock.install({ time: new Date("2026-11-16T03:00:00Z") });
  await page.clock.pauseAt(new Date("2026-11-16T03:00:00.100Z"));
  try {
    await page.goto(`${baseURL}signage/?device=${deviceId}`);
    await expect(page.locator(".signage-media img")).toHaveAttribute("alt", "街の案内");
    const ticker = await page.locator(".rich-ticker").elementHandle();
    await page.clock.runFor(16000);
    expect(await ticker!.evaluate(el => el.isConnected)).toBe(true);
    await expect(page.locator(".signage-media img")).toHaveAttribute("alt", "2枚目の写真");
    await expect(page.locator(".rich-ticker")).toHaveCount(1);
  } finally { await context.close(); }
});

test("a departing vehicle uses its exit animation independently from page transitions", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const record = await mockDisplay(context, false);
  record.settings.departureAnimation = "fade"; record.settings.transition = "zoom";
  const page = await context.newPage();
  await page.clock.install({ time: new Date("2026-11-16T15:14:59Z") });
  await page.clock.pauseAt(new Date("2026-11-16T15:14:59.100Z"));
  try {
    await page.goto(`${baseURL}signage/?device=${deviceId}`);
    await expect(page.locator(".departure-list article")).toHaveCount(2);
    await page.clock.runFor(2100);
    const leaving = page.locator(".departure-list article[data-leaving=true]");
    await expect(leaving).toHaveCount(1);
    await expect(leaving).toHaveCSS("animation-name", "vehicle-fade-out");
    await expect(page.locator(".departure-pages")).toHaveAttribute("data-page-transition", "zoom");
    await page.clock.runFor(800);
    await expect(leaving).toHaveCount(0);
    await expect(page.locator(".departure-list article")).toHaveCount(1);
    await page.clock.runFor(2400);
    await expect(page.locator(".departure-pages")).toHaveCSS("animation-name", "departure-zoom");
    await expect(leaving).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator(".departure-pages")).toHaveCSS("animation-name", "none");
  } finally { await context.close(); }
});

for (const combined of [false, true]) test(`alongside media keeps ${combined ? "both directions" : "one direction"} readable at display widths`, async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  const record = await mockDisplay(context, combined);
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date("2026-11-16T03:00:00Z"));
  try {
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.goto(`${baseURL}signage/?device=${deviceId}`);
      await expect(page.locator(".departure-list article")).toHaveCount(combined ? 4 : 2);
      await expect(page.getByLabel("駅名", { exact: true })).toContainText("浅草駅");
      await expect(page.locator(".signage-media img")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator(".departure-list article").first()).toHaveCSS("opacity", "1");
      const geometry = await page.evaluate(() => {
        const rowConflicts = [...document.querySelectorAll(".departure-list article")].filter(row => {
          const time = row.querySelector("time")!.getBoundingClientRect(), type = row.querySelector(".train-type")!.getBoundingClientRect();
          return time.right > type.left + 1 && time.bottom > type.top && type.bottom > time.top;
        }).length;
        const rows = [...document.querySelectorAll(".departure-list article")];
        const lastRow = rows.at(-1)!.getBoundingClientRect(), ticker = document.querySelector(".rich-ticker")!.getBoundingClientRect();
        return { rowConflicts, overflow: document.documentElement.scrollWidth > innerWidth,
          lastRowBottom: lastRow.bottom, tickerTop: ticker.top, height: document.documentElement.scrollHeight,
          stationSize: getComputedStyle(document.querySelector(".app-facility span")!).fontSize,
          directionSize: getComputedStyle(document.querySelector(".direction-name p")!).fontSize };
      });
      expect(geometry.rowConflicts, JSON.stringify(viewport)).toBe(0);
      expect(geometry.overflow, JSON.stringify(viewport)).toBe(false);
      expect(geometry.stationSize).toBe(geometry.directionSize);
      if (viewport.width > 800) {
        expect(geometry.lastRowBottom, JSON.stringify(viewport)).toBeLessThanOrEqual(geometry.tickerTop + 1);
        expect(geometry.height, JSON.stringify(viewport)).toBeLessThanOrEqual(viewport.height + 1);
      }
      if (viewport.width === 1280) await page.screenshot({ path: `artifacts/signage-media-${combined ? "combined" : "single"}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    const sizes: number[] = [];
    for (const size of ["small", "medium", "large"] as TickerSize[]) {
      record.settings.ticker!.size = size;
      record.revision++;
      await page.reload();
      await expect(page.locator(".rich-ticker")).toHaveAttribute("data-size", size);
      await page.evaluate(() => document.fonts.ready);
      const metrics = await page.locator(".rich-ticker").evaluate(footer => {
        const frame = footer.getBoundingClientRect(), text = footer.querySelector(".rich-ticker-track")!.getBoundingClientRect();
        const rows = [...document.querySelectorAll(".departure-list article")];
        return { font: parseFloat(getComputedStyle(footer).fontSize), clipped: text.top < frame.top + 1 || text.bottom > frame.bottom - 1,
          rowBottom: rows.at(-1)!.getBoundingClientRect().bottom, tickerTop: frame.top, bottom: frame.bottom };
      });
      expect(metrics.clipped, size).toBe(false);
      expect(metrics.rowBottom, size).toBeLessThanOrEqual(metrics.tickerTop + 1);
      expect(metrics.bottom, size).toBeLessThanOrEqual(721);
      sizes.push(metrics.font);
    }
    expect(sizes[0]).toBeLessThan(sizes[1]); expect(sizes[1]).toBeLessThan(sizes[2]);
  } finally { await context.close(); }
});
