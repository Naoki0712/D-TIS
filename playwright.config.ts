import { defineConfig } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

const basePath: string = JSON.parse(readFileSync(new URL("./dist/build-metadata.json", import.meta.url), "utf8")).basePath;
const port = Number(process.env.PORT || 4173);
const systemChrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  || (process.platform === "win32" && existsSync(systemChrome) ? systemChrome : undefined);

export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}${basePath}`,
    browserName: "chromium",
    launchOptions: executablePath ? { executablePath } : {},
    viewport: { width: 1440, height: 1050 },
    screenshot: "only-on-failure",
    actionTimeout: 20000,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run preview",
    url: `http://127.0.0.1:${port}${basePath}`,
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
  },
});
