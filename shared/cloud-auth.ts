/** Keep account errors useful without exposing internal responses or credentials. */
export function authErrorMessage(error: unknown): string {
  const value = error && typeof error === "object" ? error as { code?: string; message?: string; name?: string } : {};
  const code = value.code ?? "";
  const messages: Record<string, string> = {
    invalid_credentials: "メールアドレスまたはパスワードを確認してください。",
    email_not_confirmed: "メールアドレスの確認が完了していません。確認メール内のリンクを開いてください。",
    signup_disabled: "現在、新規登録を受け付けていません。しばらくしてからお試しください。",
    email_address_not_authorized: "確認メールを送信できませんでした。サービス管理者にメール送信設定の確認を依頼してください。",
    email_address_invalid: "有効なメールアドレスを入力してください。",
    user_already_exists: "登録済みのメールアドレスです。ログインをお試しください。",
    weak_password: "パスワードが要件を満たしていません。8文字以上で、英大文字・小文字・数字・記号を組み合わせてください。",
    over_email_send_rate_limit: "確認メールの送信回数が上限に達しました。時間をおいて再度お試しください。",
    over_request_rate_limit: "操作が集中しています。少し待ってから再度お試しください。",
    otp_expired: "確認リンクの有効期限が切れているか、すでに使用されています。ログインするか、確認メールを再送してください。",
    bad_code_verifier: "この確認リンクを処理できませんでした。登録したブラウザーで開き直すか、確認メールを再送してください。",
    session_not_found: "ログインの有効期限が切れました。もう一度ログインしてください。",
    refresh_token_not_found: "ログインの有効期限が切れました。もう一度ログインしてください。",
  };
  if (messages[code]) return messages[code];
  if (value.name === "AuthRetryableFetchError" || /fetch|network|timeout|timed out|abort/i.test(value.message ?? "")) {
    return "通信できませんでした。ネットワーク接続を確認して、もう一度お試しください。";
  }
  return "アカウントの処理に失敗しました。時間をおいて、もう一度お試しください。";
}

/** The SDK consumes successful implicit callbacks; report failed email links here. */
export function consumeAuthRedirectError(): string | null {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  if (!params.has("error") && !params.has("error_code")) return null;
  const message = authErrorMessage({ code: params.get("error_code") ?? params.get("error") ?? "" });
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
  return message;
}
