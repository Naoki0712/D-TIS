import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Connect, Plugin } from "vite";

const assetsDirectory = fileURLToPath(new URL("../assets/", import.meta.url));
const mimeTypes: Record<string, string> = {
  ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon",
};

/** Keep media in the repository's shared assets directory in dev and preview too. */
export function rootAssetsPlugin(basePath = "/"): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    let pathname: string;
    try { pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname); }
    catch { res.statusCode = 400; res.end(); return; }
    const assetPrefix = `${basePath}assets/`;
    if (!pathname.startsWith(assetPrefix)) return next();
    const target = path.resolve(assetsDirectory, pathname.slice(assetPrefix.length));
    const relative = path.relative(assetsDirectory, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      res.statusCode = 403; res.end(); return;
    }
    void fs.stat(target).then(stat => {
      if (!stat.isFile()) { res.statusCode = 404; res.end(); return; }
      res.setHeader("Content-Type", mimeTypes[path.extname(target).toLowerCase()] ?? "application/octet-stream");
      res.setHeader("Content-Length", stat.size);
      res.setHeader("Cache-Control", "no-cache");
      if (req.method === "HEAD") { res.end(); return; }
      createReadStream(target).on("error", () => res.destroy()).pipe(res);
    }, () => { res.statusCode = 404; res.end(); });
  };
  return {
    name: "shared-root-assets",
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}
