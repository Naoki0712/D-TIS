import { test, expect } from "@playwright/test";
import { DEFAULT_CLOUD_CONFIG } from "../shared/public-config";
import { Buffer } from "node:buffer";

test("new visitors can register without configuring services and request a confirmation email", async ({ page, baseURL }) => {
  let signup = 0, resends = 0;
  await page.route(`${DEFAULT_CLOUD_CONFIG.url}/**`, async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.endsWith("/signup")) {
      signup++;
      expect(request.postDataJSON()).toMatchObject({ email: "new-user@example.test", password: "new-test-password" });
      expect(url.searchParams.get("redirect_to")).toBe(`${baseURL}controller/`);
      await route.fulfill({ json: { id: "30000000-0000-4000-8000-000000000003", aud: "authenticated", email: "new-user@example.test", identities: [] } }); return;
    }
    if (url.pathname.endsWith("/resend")) {
      resends++; expect(request.postDataJSON().type).toBe("signup");
      await route.fulfill({ json: {} }); return;
    }
    throw new Error(`Unexpected auth request: ${url.pathname}`);
  });
  await page.goto(`${baseURL}controller/`);
  await expect(page.getByLabel("Supabase Project URL")).toHaveCount(0);
  await expect(page.getByLabel("ODPT APIトークン")).toHaveCount(0);
  await page.getByRole("tab", { name: "新規登録" }).click();
  await page.getByLabel("メールアドレス").fill("new-user@example.test");
  await page.getByLabel("パスワード", { exact: true }).fill("new-test-password");
  await page.getByRole("button", { name: "アカウントを作成" }).click();
  await expect(page.getByRole("status")).toContainText("確認メールを送信しました");
  expect(signup).toBe(1);
  await page.getByRole("button", { name: "確認メールを再送" }).click();
  await expect(page.getByRole("status")).toContainText("確認メールを再送しました");
  expect(resends).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/public-signup-mobile.png", fullPage: true });
});

test("expired confirmation links and SMTP configuration errors are shown in Japanese", async ({ page, baseURL }) => {
  await page.route(`${DEFAULT_CLOUD_CONFIG.url}/**`, route => route.fulfill({ status: 400, headers: { "x-supabase-api-version": "2024-01-01", "Access-Control-Expose-Headers": "X-Supabase-Api-Version" },
    json: { code: "email_address_not_authorized", message: "Email address not authorized" } }));
  await page.goto(`${baseURL}controller/#error=access_denied&error_code=otp_expired&error_description=expired`);
  await expect(page.getByRole("alert")).toContainText("確認リンクの有効期限");
  expect(new URL(page.url()).hash).toBe("");
  await page.getByRole("tab", { name: "新規登録" }).click();
  await page.getByLabel("メールアドレス").fill("new-user@example.test");
  await page.getByLabel("パスワード", { exact: true }).fill("new-test-password");
  await page.getByRole("button", { name: "アカウントを作成" }).click();
  await expect(page.getByRole("alert")).toContainText("メール送信設定の確認");
});

test("a successful confirmation link restores the account and clears callback tokens from the URL", async ({ page, baseURL }) => {
  const id = "30000000-0000-4000-8000-000000000003";
  const user = { id, aud: "authenticated", role: "authenticated", email: "new-user@example.test", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
  const jwt = `${Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: id, aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.fixture-signature`;
  await page.route(`${DEFAULT_CLOUD_CONFIG.url}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/v1/user") { await route.fulfill({ json: user }); return; }
    if (path === "/rest/v1/dtis_devices") { await route.fulfill({ json: [] }); return; }
    throw new Error(`Unexpected confirmation request: ${path}`);
  });
  await page.route("https://api.odpt.org/**", route => route.fulfill({ json: [] }));
  await page.goto(`${baseURL}controller/#${new URLSearchParams({ access_token: jwt, refresh_token: "fixture-refresh", expires_in: "3600", token_type: "bearer", type: "signup" })}`);
  await expect(page.getByRole("heading", { name: "Signageを開いてください" })).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  await page.getByLabel("アカウントを開く").click();
  await expect(page.getByText("new-user@example.test", { exact: true })).toBeVisible();
});
