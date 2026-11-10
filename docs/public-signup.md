# D-TISの一般利用者登録を開始する

アプリの公開用接続先・ODPT専用トークン・新規登録画面は設定済みです。利用者はURLやAPIキーを入力しません。Supabaseで新規登録とメール・パスワード認証が有効になっていることは確認済みです。

## 残っている管理者の設定

1. SupabaseのD-TISプロジェクトで **Authentication → Email → SMTP Settings** を開き、独自SMTPを有効にします。メール配信サービスが発行したホスト・ポート・ユーザー名・パスワードと、確認済みの送信元メールアドレスを設定します。SMTPの認証情報はSupabaseにだけ登録し、GitHubへは追加しません。
2. **Authentication → URL Configuration** で、Site URLを `https://d-tis.com/controller/` にします。
3. 同画面のRedirect URLsに次の2件を追加します。
   - `https://d-tis.com/controller/`
   - `https://d-tis.com/signage/`
4. メール確認は有効のまま、[Controller](https://d-tis.com/controller/)の「新規登録」から管理者の手元で受信できるテスト用メールアドレスを登録します。確認メールからアプリへ戻れることを確認します。
5. 同じアカウントで[Signage](https://d-tis.com/signage/)を開き、Controller上部の「LCD メイン画面」から自分のSignageが選べることを確認します。

Supabase標準のメール送信では、一般利用者宛ての確認メールを送れません。[Supabase公式の独自SMTP設定](https://supabase.com/docs/guides/auth/auth-smtp)も参照してください。

## 利用者の操作

「新規登録」→ 確認メールを開く → SignageとControllerで同じアカウントにログイン、の順で開始します。管理者によるUsersへの事前登録は不要です。自分以外のアカウントの端末は表示・操作できません。

Controller上部のデバイスボタンに、操作するSignage・表示状態・最終応答・デバイス名・Supabaseからの再読込を集約しています。名前を変更したら「変更を反映して記録」を押します。Signageでの反映と記録が完了してから確定します。

「路線を追加」では鉄道・バスを切り替え、路線・系統で絞り込めます。「続きを表示」で全ての駅・停留所を確認できます。現在の対応範囲は東京メトロ、都営交通、横浜市営地下鉄、つくばエクスプレス、ゆりかもめと都営バスです。
