// Local inspection of the exact static package sent to GitHub Pages.
import http from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
let metadata;
try { metadata = JSON.parse(await readFile(path.join(root, "build-metadata.json"), "utf8")); }
catch { throw new Error("Run npm run build before npm run preview."); }
const basePath = metadata.basePath;
const port = Number(process.env.PORT || 4173);
const contentTypes = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".woff": "font/woff", ".woff2": "font/woff2",
};

http.createServer(async (request, response) => {
  try {
    if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405); response.end(); return; }
    const url = new URL(request.url || "/", "http://localhost");
    if (url.pathname === basePath.slice(0, -1) || (url.pathname === "/" && basePath !== "/")) {
      response.writeHead(302, { Location: basePath }); response.end(); return;
    }
    if (!url.pathname.startsWith(basePath)) { response.writeHead(404); response.end(); return; }
    const route = decodeURIComponent(url.pathname.slice(basePath.length));
    let file = path.resolve(root, route || ".");
    const relative = path.relative(root, file);
    if (relative.startsWith("..") || path.isAbsolute(relative)) { response.writeHead(403); response.end(); return; }
    if ((await stat(file)).isDirectory()) {
      if (!url.pathname.endsWith("/")) { response.writeHead(302, { Location: `${url.pathname}/${url.search}` }); response.end(); return; }
      file = path.join(file, "index.html");
    }
    const details = await stat(file);
    if (!details.isFile()) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "Content-Type": contentTypes[path.extname(file).toLowerCase()] || "application/octet-stream", "Content-Length": details.size, "Cache-Control": "no-cache" });
    if (request.method === "HEAD") response.end();
    else createReadStream(file).on("error", () => response.destroy()).pipe(response);
  } catch { response.writeHead(404); response.end(); }
}).listen(port, "127.0.0.1", () => console.log(`Local: http://localhost:${port}${basePath}`));
