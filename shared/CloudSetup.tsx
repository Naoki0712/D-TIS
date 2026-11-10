import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { getCloudClient, readCloudConfig, saveCloudConfig } from "./cloud";
import { readOdptConfig, saveOdptConfig } from "./browser-odpt";
import { AppHeader } from "./AppHeader";
import "./cloud.css";

export function CloudGate({ product, children }: { product: "Controller" | "Signage"; children: ReactNode }) {
  const [config, setConfig] = useState(readCloudConfig);
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState(config?.url ?? "");
  const [key, setKey] = useState(config?.key ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [odpt, setOdpt] = useState(readOdptConfig);
  const [odptNote, setOdptNote] = useState("");
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!config?.url || !config.key) { setChecking(false); return; }
    let alive = true;
    try {
      const client = getCloudClient();
      void client.auth.getSession().then(({ data, error }) => {
        if (alive) { setSession(data.session); setChecking(false); if (error) setError(error.message); }
      }).catch(error => { if (alive) { setError(String(error)); setChecking(false); } });
      const { data } = client.auth.onAuthStateChange((_event, next) => { if (alive) setSession(next); });
      return () => { alive = false; data.subscription.unsubscribe(); };
    } catch (error) { setError(String(error)); setChecking(false); }
    return () => { alive = false; };
  }, [config]);

  function configure(event: FormEvent) {
    event.preventDefault();
    try {
      saveCloudConfig({ url: url.trim(), key: key.trim() });
      setSession(null); setChecking(true); setConfig(readCloudConfig()); setEditing(false); setError("");
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  }
  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const { error } = await getCloudClient().auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      setPassword("");
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  function saveOdpt(event: FormEvent) {
    event.preventDefault();
    try { saveOdptConfig(odpt); setOdptNote("このブラウザーの接続設定を保存しました。"); }
    catch (error) { setOdptNote(error instanceof Error ? error.message : String(error)); }
  }
  const odptForm = <form className="cloud-form" onSubmit={saveOdpt}>
    <h3>ODPT・GTFS接続</h3>
    <label>ODPT APIトークン<input type="password" value={odpt.token} onChange={event => setOdpt({ ...odpt, token: event.target.value })} autoComplete="off" /></label>
    <label>ODPT API URL<input type="url" value={odpt.baseUrl ?? ""} onChange={event => setOdpt({ ...odpt, baseUrl: event.target.value })} placeholder="https://api.odpt.org/api/v4" /></label>
    <label>GTFS Schedule URL（1行に1件）<textarea rows={3} value={(odpt.gtfsUrls ?? []).join("\n")} onChange={event => setOdpt({ ...odpt, gtfsUrls: event.target.value.split("\n").map(v => v.trim()).filter(Boolean) })} placeholder="https://…/gtfs.zip" /></label>
    <small>SignageとControllerの両方に同じ配信元を設定してください。トークンはこのブラウザーに保存します。配信元のCORS許可が必要です。</small>
    <button type="submit">接続設定を保存</button><p role="status">{odptNote}</p>
  </form>;

  if (session && !editing) return <>
    <div key={`${config.url}|${session.user.id}`}>{children}</div>
    <details className="cloud-account" data-preview-ignore><summary aria-label="接続設定を開く">接続設定</summary>
      <div className="cloud-account-panel"><p>{session.user.email}</p>{odptForm}
        <button type="button" onClick={() => setEditing(true)}>Supabase接続を変更</button>
        <button type="button" onClick={() => void getCloudClient().auth.signOut().then(({ error }) => { if (error) setError(error.message); })}>ログアウト</button>
        {error && <p role="alert">{error}</p>}
      </div>
    </details>
  </>;
  return <main className="cloud-setup"><AppHeader product={product} /><section className="cloud-setup-panel">
    <p className="cloud-eyebrow">D-TIS · GITHUB PAGES</p><h1>{checking ? "接続を確認しています" : "SignageとControllerをつなぐ"}</h1>
    <p>Supabaseに用意した運用アカウントで、両方の画面にログインしてください。Signageを開くと、このアカウントの端末として登録されます。</p>
    {(!config?.url || !config.key || editing) && <form className="cloud-form" onSubmit={configure}>
      <label>Supabase Project URL<input type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://your-project.supabase.co" required /></label>
      <label>Publishable key<input type="password" value={key} onChange={event => setKey(event.target.value)} placeholder="sb_publishable_…" required autoComplete="off" /></label>
      <small>SupabaseのSQL Editorでsupabase/setup.sqlを実行してから接続してください。</small>
      <button type="submit">接続を設定</button>{session && <button type="button" onClick={() => setEditing(false)}>戻る</button>}
    </form>}
    {config?.url && config.key && !editing && !checking && <form className="cloud-form" onSubmit={login}>
      <label>メールアドレス<input type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></label>
      <label>パスワード<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
      <button disabled={busy} type="submit">{busy ? "ログイン中…" : "ログイン"}</button>
      <button type="button" onClick={() => setEditing(true)}>Supabase接続を変更</button>
    </form>}
    {error && <p className="cloud-error" role="alert">{error}</p>}
  </section></main>;
}
