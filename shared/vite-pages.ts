import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { normalizeBasePath } from "./base-path";

export const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

export function pagesBase(mode: string): string {
  const env = loadEnv(mode, repositoryRoot, "");
  return normalizeBasePath(process.env.PAGES_BASE ?? env.PAGES_BASE ?? "/");
}
