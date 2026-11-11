import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { getCloudClient, readCloudConfig } from "./cloud";
import { authErrorMessage, consumeAuthRedirectError } from "./cloud-auth";
import { AppHeader } from "./AppHeader";
import "./cloud.css";

export function CloudGate({ product, children }: { product: "Controller" | "Signage"; children: ReactNode }) {
  const [config] = useState(readCloudConfig);
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmationEmail, setConfirmationEmail] = useState("");
  const configured = Boolean(config.url && config.key);

  useEffect(() => {
    if (!configured) { setChecking(false); return; }
    let alive = true;
    const redirectError = consumeAuthRedirectError();
    if (redirectError) setError(redirectError);
    try {
      const client = getCloudClient();
      void client.auth.getSession().then(({ data, error }) => {
        if (alive) {
          setSession(data.session); setChecking(false);
          if (error) setError(authErrorMessage(error));
        }
      }).catch(error => { if (alive) { setError(authErrorMessage(error)); setChecking(false); } });
      const { data } = client.auth.onAuthStateChange((_event, next) => {
        if (alive) setSession(next);
      });
      return () => { alive = false; data.subscription.unsubscribe(); };
    } catch (error) { setError(authErrorMessage(error)); setChecking(false); }
    return () => { alive = false; };
  }, [configured]);

  // Stay on the same app after email confirmation, including GitHub project subpaths.
  const confirmationRedirect = () => `${window.location.origin}${window.location.pathname}`;
  async function authenticate(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const auth = getCloudClient().auth;
      const credentials = { email: email.trim(), password };
      if (mode === "signup") {
        const { data, error } = await auth.signUp({ ...credentials,
          options: { emailRedirectTo: confirmationRedirect() } });
        if (error) throw error;
        if (!data.session) {
          setConfirmationEmail(credentials.email);
          // Supabase intentionally gives the same reply for some existing accounts.
          setNotice("確認メールを送信しました。メール内のリンクを開いて登録を完了してください。登録済みの場合は、ログインをお試しください。");
        }
      } else {
        const { error } = await auth.signInWithPassword(credentials);
        if (error) {
          if (error.code === "email_not_confirmed") setConfirmationEmail(credentials.email);
          throw error;
        }
      }
      setPassword("");
    } catch (error) { setError(authErrorMessage(error)); }
    finally { setBusy(false); }
  }
  async function resendConfirmation() {
    if (!confirmationEmail || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const { error } = await getCloudClient().auth.resend({ type: "signup", email: confirmationEmail,
        options: { emailRedirectTo: confirmationRedirect() } });
      if (error) throw error;
      setNotice("確認メールを再送しました。迷惑メールフォルダーもご確認ください。");
    } catch (error) { setError(authErrorMessage(error)); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError("");
    try {
      // Signing out this browser must not stop a separately signed-in Signage.
      const { error } = await getCloudClient().auth.signOut({ scope: "local" });
      if (error) throw error;
      setNotice(""); setPassword(""); setConfirmationEmail("");
    } catch (error) { setError(authErrorMessage(error)); }
    finally { setBusy(false); }
  }

  if (session) return <>
    <div key={`${config.url}|${session.user.id}`}>{children}</div>
    <details className="cloud-account" data-preview-ignore>
      <summary aria-label="アカウントを開く">アカウント</summary>
      <div className="cloud-account-panel"><p>{session.user.email}</p>
        <button type="button" disabled={busy} onClick={() => void logout()}>{busy ? "ログアウト中…" : "ログアウト"}</button>
        {error && <p className="cloud-error" role="alert">{error}</p>}
      </div>
    </details>
  </>;

  return <main className="cloud-setup"><AppHeader product={product} /><section className="cloud-setup-panel">
    <p className="cloud-eyebrow">D-TIS · {product}</p>
    <h1>{checking ? "ログインを確認しています" : mode === "signup" ? "アカウントを作成" : "D-TISにログイン"}</h1>
    <p>はじめての方も新規登録してご利用いただけます。SignageとControllerには同じアカウントでログインしてください。</p>
    <p className="cloud-auth-help">Signageを開くと自分の端末として登録され、Controllerから操作できます。</p>
    {!configured && <p className="cloud-error" role="alert">サービスの公開準備中です。時間をおいて、もう一度アクセスしてください。</p>}
    {configured && !checking && <>
      <div className="cloud-auth-tabs" role="tablist" aria-label="アカウントへのアクセス">
        <button id="cloud-login-tab" role="tab" type="button" aria-controls="cloud-auth-form" aria-selected={mode === "login"}
          disabled={busy} onClick={() => { setMode("login"); setError(""); setPassword(""); }}>ログイン</button>
        <button id="cloud-signup-tab" role="tab" type="button" aria-controls="cloud-auth-form" aria-selected={mode === "signup"}
          disabled={busy} onClick={() => { setMode("signup"); setError(""); setPassword(""); }}>新規登録</button>
      </div>
      <form id="cloud-auth-form" className="cloud-form" onSubmit={authenticate} aria-labelledby={`cloud-${mode}-tab`}>
        <label>メールアドレス<input type="email" autoComplete="username" autoCapitalize="none" spellCheck={false}
          value={email} onChange={event => { setEmail(event.target.value); setConfirmationEmail(""); setNotice(""); }} required disabled={busy} /></label>
        <label>パスワード<input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"}
          value={password} onChange={event => setPassword(event.target.value)} minLength={mode === "signup" ? 8 : undefined}
          aria-describedby={mode === "signup" ? "cloud-password-help" : undefined} required disabled={busy} /></label>
        {mode === "signup" && <small id="cloud-password-help">8文字以上のパスワードを設定してください。</small>}
        <button disabled={busy} type="submit">{busy ? "処理中…" : mode === "signup" ? "アカウントを作成" : "ログイン"}</button>
      </form>
      {confirmationEmail && <button className="cloud-resend" type="button" disabled={busy} onClick={() => void resendConfirmation()}>確認メールを再送</button>}
    </>}
    {notice && <p className="cloud-notice" role="status">{notice}</p>}
    {error && <p className="cloud-error" role="alert">{error}</p>}
  </section></main>;
}
