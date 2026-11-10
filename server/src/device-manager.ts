import type { Express, Request, RequestHandler } from "express";
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import { hostname, networkInterfaces } from "node:os";
import path from "node:path";
import type { PowerAction, PowerController } from "./power.js";

const PIN_TTL = 5 * 60_000;
const HEARTBEAT_TTL = 15_000;
type Pairing = { pin: string; expiresAt: string };
type Controller = { id: string; name: string; tokenHash: string; pairedAt: string };
type Stored = { version: 1; deviceId: string; displayEnabled: boolean; controllers: Controller[] };
type Options = {
  dataDirectory: string;
  port: number;
  getSettingsVersion: () => Promise<string>;
  power: PowerController;
  now?: () => number;
  powerDelayMs?: number;
};
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const normalizedAddress = (value: string) => value.toLowerCase().replace(/^::ffff:/, "").replace(/^\[|\]$/g, "").split("%")[0];
let localIdentityCache: { addresses: Set<string>; names: Set<string>; refreshedAt: number } | undefined;
function localIdentity() {
  if (localIdentityCache && Date.now() - localIdentityCache.refreshedAt < 1000) return localIdentityCache;
  const addresses = new Set(["127.0.0.1", "::1", ...Object.values(networkInterfaces()).flatMap(items => items ?? []).map(item => normalizedAddress(item.address))]);
  const machine = hostname().toLowerCase();
  const shortMachine = machine.split(".")[0];
  return localIdentityCache = { addresses, names: new Set(["localhost", machine, shortMachine, `${shortMachine}.local`]), refreshedAt: Date.now() };
}

// A local browser may use the machine's own IP or hostname instead of localhost.
// Verify the actual socket too: a LAN client cannot gain PIN access by spoofing Host.
export function isLocalSignageRequest(q: Request): boolean {
  const identity = localIdentity();
  if (!identity.addresses.has(normalizedAddress(q.socket.remoteAddress ?? "")) || q.get("x-dtis-remote-client")) return false;
  try {
    const host = new URL(`http://${q.get("host")}`);
    if (host.username || host.password || host.pathname !== "/" || host.search || host.hash) return false;
    const name = normalizedAddress(host.hostname).replace(/\.$/, "");
    if (!identity.addresses.has(name) && !identity.names.has(name)) return false;
    const origin = q.get("origin");
    if (origin && new URL(origin).host !== host.host) return false;
    const site = q.get("sec-fetch-site");
    return !site || site === "same-origin" || site === "none";
  } catch { return false; }
}

export async function createDeviceManager(options: Options) {
  const now = options.now ?? Date.now;
  const file = path.join(options.dataDirectory, "pairing.json");
  await fs.mkdir(options.dataDirectory, { recursive: true });
  let stored: Stored;
  async function persist(value: Stored) {
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
      await fs.rename(temp, file);
    } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
  }
  try {
    stored = JSON.parse(await fs.readFile(file, "utf8"));
    if (stored.version !== 1 || typeof stored.deviceId !== "string" ||
        typeof stored.displayEnabled !== "boolean" || !Array.isArray(stored.controllers) ||
        stored.controllers.some((c) => !c || typeof c.id !== "string" || typeof c.name !== "string" ||
          typeof c.pairedAt !== "string" || typeof c.tokenHash !== "string" || !/^[a-f0-9]{64}$/.test(c.tokenHash))) {
      throw new Error("Invalid pairing state");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error("pairing.jsonを読み込めません。認証を保護するため起動を中止します。", { cause: error });
    }
    stored = { version: 1, deviceId: randomUUID(), displayEnabled: true, controllers: [] };
    await persist(stored);
  }
  let pairing: Pairing | null = null;
  let lastSeen: number | null = null;
  let refreshVersion = 0;
  let pendingPower: { action: PowerAction; requestedAt: string } | null = null;
  let powerError: string | null = null;
  let powerTimer: ReturnType<typeof setTimeout> | undefined;
  let powerWatchdog: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  function exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work);
    queue = next.catch(() => {});
    return next;
  }
  function newPin() {
    pairing = { pin: randomInt(0, 1_000_000).toString().padStart(6, "0"), expiresAt: new Date(now() + PIN_TTL).toISOString() };
  }
  function currentPairing() {
    if (pairing && Date.parse(pairing.expiresAt) <= now()) pairing = null;
    if (!pairing && !stored.controllers.length) newPin();
    return pairing;
  }
  const attempts = new Map<string, { count: number; resetAt: number }>();
  function rateAllowed(ip: string) {
    for (const [key, value] of attempts) if (value.resetAt <= now()) attempts.delete(key);
    // Include a global bound so many source addresses cannot brute-force a six-digit code.
    for (const [key, limit] of [["global", 30], [ip, 10]] as const) {
      const value = attempts.get(key) ?? { count: 0, resetAt: now() + PIN_TTL };
      if (value.count >= limit) return false;
      value.count++;
      attempts.set(key, value);
    }
    return true;
  }
  function authenticated(q: Request): Controller | undefined {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(q.get("authorization") ?? "");
    if (!match) return;
    const hash = Buffer.from(digest(match[1]), "hex");
    return stored.controllers.find((controller) => timingSafeEqual(Buffer.from(controller.tokenHash, "hex"), hash));
  }
  const requireController: RequestHandler = (q, s, next) => {
    if (!authenticated(q)) { s.status(401).json({ message: "SignageのPINでペアリングしてください。" }); return; }
    next();
  };
  async function status() {
    return {
      deviceId: stored.deviceId, hostname: hostname(), displayEnabled: stored.displayEnabled,
      refreshVersion, settingsVersion: await options.getSettingsVersion(),
      signageOnline: lastSeen !== null && now() - lastSeen < HEARTBEAT_TTL,
      lastSeenAt: lastSeen === null ? null : new Date(lastSeen).toISOString(),
      power: { supported: options.power.supported, reason: options.power.reason }, pendingPower, powerError,
    };
  }
  async function localState() {
    const addresses = Object.values(networkInterfaces()).flatMap((items) => items ?? [])
      .filter((item) => item.family === "IPv4" && !item.internal).map((item) => item.address);
    return {
      ...await status(), paired: stored.controllers.length > 0, pairing: currentPairing(),
      controllerUrls: [...new Set(addresses)].map((ip) => `http://${ip}:${options.port}/controller/`),
    };
  }
  function mount(app: Express) {
    app.use("/api", (q, s, next) => {
      s.setHeader("Cache-Control", "no-store");
      if (["POST", "PUT", "PATCH"].includes(q.method) && !q.is("application/json")) {
        s.status(415).json({ message: "Content-Type: application/json が必要です。" }); return;
      }
      if (q.path.toLowerCase().startsWith("/signage/")) {
        if (!isLocalSignageRequest(q)) { s.status(403).json({ message: "PINはSignage本体の画面で確認してください。" }); return; }
      } else {
        s.setHeader("Access-Control-Allow-Origin", "*");
        s.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        s.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS");
      }
      if (q.method === "OPTIONS") { s.sendStatus(204); return; }
      next();
    });
    app.get("/api/signage/state", async (_q, s) => { s.json(await localState()); });
    app.post("/api/signage/heartbeat", async (_q, s) => {
      lastSeen = now();
      s.json(await localState());
    });
    app.post("/api/signage/pairing", async (_q, s) => { newPin(); s.json(await localState()); });
    app.post("/api/pairing/claim", async (q, s) => {
      await exclusive(async () => {
        if (!rateAllowed(q.socket.remoteAddress ?? "unknown")) {
          s.setHeader("Retry-After", "300");
          s.status(429).json({ message: "PINの試行回数が上限に達しました。5分後に再試行してください。" }); return;
        }
        const pin = q.body?.pin;
        const active = currentPairing();
        if (typeof pin !== "string" || !/^\d{6}$/.test(pin) || !active ||
            !timingSafeEqual(Buffer.from(pin), Buffer.from(active.pin))) {
          s.status(400).json({ message: "PINが違うか、有効期限が切れています。Signageの画面を確認してください。" }); return;
        }
        if (stored.controllers.length >= 32) {
          s.status(409).json({ message: "Controllerの登録上限です。不要な連携を解除してください。" }); return;
        }
        const token = randomBytes(32).toString("base64url");
        const next: Stored = { ...stored, controllers: [...stored.controllers, {
          id: randomUUID(), name: typeof q.body?.name === "string" ? q.body.name.trim().slice(0, 80) || "Controller" : "Controller",
          tokenHash: digest(token), pairedAt: new Date(now()).toISOString(),
        }] };
        await persist(next);
        stored = next;
        pairing = null;
        s.status(201).json({ token, device: await status() });
      });
    });
    app.delete("/api/pairing/controller", requireController, async (q, s) => {
      await exclusive(async () => {
        const controller = authenticated(q);
        if (!controller) { s.sendStatus(401); return; }
        const next = { ...stored, controllers: stored.controllers.filter((item) => item.id !== controller.id) };
        await persist(next);
        stored = next;
        s.json({ ok: true });
      });
    });
    app.use("/api/device", requireController);
    app.get("/api/device", async (_q, s) => { s.json(await status()); });
    app.post("/api/device/display", async (q, s) => {
      if (typeof q.body?.enabled !== "boolean") { s.status(400).json({ message: "enabledは真偽値で指定してください。" }); return; }
      await exclusive(async () => {
        if (!authenticated(q)) { s.sendStatus(401); return; }
        const next = { ...stored, displayEnabled: q.body.enabled };
        await persist(next);
        stored = next;
        s.json(await status());
      });
    });
    app.post("/api/device/refresh", async (_q, s) => { refreshVersion++; s.json(await status()); });
    app.post("/api/device/power", async (q, s) => {
      const action = q.body?.action;
      if (action !== "reboot" && action !== "shutdown") { s.status(400).json({ message: "未対応の電源操作です。" }); return; }
      if (!options.power.supported) { s.status(403).json({ message: options.power.reason }); return; }
      if (pendingPower) { s.status(409).json({ message: "電源操作はすでに受け付けています。" }); return; }
      pendingPower = { action, requestedAt: new Date(now()).toISOString() };
      powerError = null;
      // Queue only fixed power actions, after allowing the accepted response to reach Controller.
      powerTimer = setTimeout(async () => {
        try {
          await options.power.execute(action);
          powerWatchdog = setTimeout(() => {
            pendingPower = null;
            powerError = "電源コマンド実行後もサーバーが応答しています。本体の状態を確認してください。";
          }, 60_000);
          powerWatchdog.unref();
        } catch {
          pendingPower = null;
          powerError = "電源操作に失敗しました。sudo権限とsystemdのログを確認してください。";
        }
      }, options.powerDelayMs ?? 1500);
      powerTimer.unref();
      s.status(202).json({ accepted: true, pendingPower });
    });
  }
  return { mount, requireController, close() { clearTimeout(powerTimer); clearTimeout(powerWatchdog); } };
}
