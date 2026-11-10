import { build, loadEnv } from "vite";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPublicEnvironment } from "./check-public-env.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
assertPublicEnvironment({ ...loadEnv("production", root, "VITE_"), ...process.env });
const output = path.resolve(root, "dist");
if (path.dirname(output) !== path.resolve(root) || path.basename(output) !== "dist") {
  throw new Error("Refusing to replace a build directory outside this repository.");
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const app of ["website", "signage", "controller"]) {
  await build({ root: path.join(root, app), configFile: path.join(root, app, "vite.config.ts") });
  await cp(path.join(root, app, "dist"), app === "website" ? output : path.join(output, app), { recursive: true });
}
await cp(path.join(root, "assets"), path.join(output, "assets"), { recursive: true });
await writeFile(path.join(output, ".nojekyll"), "");
// The root HTML is built with the same prefix as all app and media URLs.
const html = await readFile(path.join(output, "index.html"), "utf8");
const script = html.match(/src="([^"]*?)bundles\//)?.[1];
if (!script?.startsWith("/")) throw new Error("Cannot determine the built Pages base path.");
await writeFile(path.join(output, "build-metadata.json"), JSON.stringify({ basePath: script }, null, 2));
console.log(`\nStatic Pages package: ${output}\nBase path: ${script}`);
