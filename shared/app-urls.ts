import { siteBaseFromAppBase } from "./base-path";

// Optional access also permits importing display helpers in Node-based tests.
const env = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;
declare const __DTIS_SITE_BASE__: string | undefined;
export const siteBasePath = typeof __DTIS_SITE_BASE__ === "string"
  ? __DTIS_SITE_BASE__
  : siteBaseFromAppBase(env?.BASE_URL ?? "/");

export function sitePath(path = ""): string {
  return `${siteBasePath}${path.replace(/^\/+/, "")}`;
}
