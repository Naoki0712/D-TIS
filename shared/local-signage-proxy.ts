import { hostname, networkInterfaces } from "node:os";
import type { IncomingMessage } from "node:http";
import type { Connect, Plugin } from "vite";

const normalizedAddress = (value: string) => value.toLowerCase().replace(/^::ffff:/, "").replace(/^\[|\]$/g, "").split("%")[0];
function localHostnames() {
  const machine = hostname().toLowerCase();
  const shortMachine = machine.split(".")[0];
  return ["localhost", machine, shortMachine, `${shortMachine}.local`];
}
let localAddressesCache: { addresses: Set<string>; refreshedAt: number } | undefined;
function localAddresses() {
  if (!localAddressesCache || Date.now() - localAddressesCache.refreshedAt >= 1000) {
    localAddressesCache = {
      addresses: new Set(["127.0.0.1", "::1", ...Object.values(networkInterfaces()).flatMap(items => items ?? []).map(item => normalizedAddress(item.address))]),
      refreshedAt: Date.now(),
    };
  }
  return localAddressesCache.addresses;
}

// Keep this policy in sync with server's isLocalSignageRequest. The server cannot
// see the original socket after Vite proxies a request back over loopback.
export function isLocalSignageProxyRequest(req: Pick<IncomingMessage, "headers" | "socket">): boolean {
  const addresses = localAddresses();
  if (!addresses.has(normalizedAddress(req.socket.remoteAddress ?? "")) || req.headers["x-dtis-remote-client"]) return false;
  try {
    const host = new URL(`http://${req.headers.host}`);
    if (host.username || host.password || host.pathname !== "/" || host.search || host.hash) return false;
    const name = normalizedAddress(host.hostname).replace(/\.$/, "");
    if (!addresses.has(name) && !localHostnames().includes(name)) return false;
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== host.host) return false;
    const site = req.headers["sec-fetch-site"];
    return !site || site === "same-origin" || site === "none";
  } catch { return false; }
}

// The dev proxy otherwise makes every LAN client appear to be localhost to the API.
export function localSignageProxyGuard(): Plugin {
  const guard: Connect.NextHandleFunction = (req, res, next) => {
    const apiPath = req.url?.toLowerCase();
    if (apiPath?.startsWith("/api/") && !isLocalSignageProxyRequest(req)) {
      req.headers["x-dtis-remote-client"] = "1";
      if (apiPath.startsWith("/api/signage/")) {
        res.statusCode = 403;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ message: "PINはSignage本体の画面で確認してください。" }));
        return;
      }
    }
    // Controller and Signage use different development ports. Let the API's
    // existing public CORS contract handle preflight, before Vite's asset CORS
    // middleware can end an IP-address request without the required headers.
    if (req.method === "OPTIONS" && apiPath?.startsWith("/api/") && !apiPath.startsWith("/api/signage/")) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS");
      res.setHeader("Cache-Control", "no-store");
      res.statusCode = 204;
      res.end();
      return;
    }
    next();
  };
  return {
    name: "local-signage-proxy-guard",
    config() {
      return { server: { allowedHosts: localHostnames() }, preview: { allowedHosts: localHostnames() } };
    },
    configResolved(config) {
      // Vite's string proxy shorthand enables changeOrigin. Preserve the browser
      // Host so the API can compare its Origin after validating the local socket.
      for (const proxies of [config.server.proxy, config.preview.proxy]) {
        const api = proxies?.["/api"];
        if (proxies && api) proxies["/api"] = typeof api === "string"
          ? { target: api, changeOrigin: false }
          : { ...api, changeOrigin: false };
      }
    },
    configureServer(server) {
      // Vite installs its CORS middleware before configureServer hooks.
      server.middlewares.stack.unshift({ route: "", handle: guard });
    },
    configurePreviewServer(server) { server.middlewares.stack.unshift({ route: "", handle: guard }); },
  };
}
