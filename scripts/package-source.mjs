import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { zipSync } from "fflate";

const root = fileURLToPath(new URL("../", import.meta.url));
const directories = [".github", "assets", "controller", "docs", "e2e", "scripts", "shared", "signage", "supabase", "website", "server"];
const files = [".env.example", ".gitignore", "package.json", "package-lock.json", "tsconfig.json", "playwright.config.ts", "README.md"];
const entries = {};
async function include(relative) {
  const target = path.resolve(root, relative);
  if (!target.startsWith(root) || relative.split(/[\\/]/).includes("..")) throw new Error("Invalid source path");
  entries[`D-TIS/${relative.replaceAll("\\", "/")}`] = new Uint8Array(await readFile(target));
}
async function walk(relative) {
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    if (["node_modules", "dist", "data", "test-results", "playwright-report"].includes(entry.name) || entry.name.endsWith(".tsbuildinfo") || entry.name.startsWith(".env") && entry.name !== ".env.example") continue;
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) await walk(next);
    else if (entry.isFile()) await include(next);
  }
}
for (const directory of directories) await walk(directory);
for (const file of files) await include(file);
const output = path.join(root, "artifacts", "D-TIS-GitHub-Pages.zip");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, zipSync(entries, { level: 6 }));
console.log(`Prepared ${Object.keys(entries).length} source files: ${output}`);
