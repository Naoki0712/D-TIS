# GitHub Pagesへの配置

この構成の公開先は静的なGitHub Pagesです。Node.js、Express、Raspberry Pi上のAPIサーバーは公開先で動かしません。Supabaseの認証・データベース・Realtimeを両画面から利用します。

## GitHubで行う設定

1. このフォルダーをGitHubのリポジトリへ追加します。`node_modules`、`.env`、`server/data`、既存のZIPファイルはアップロード不要です。`.gitignore`で除外しています。
2. リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にします。
3. `main`へpushすると、[`.github/workflows/pages.yml`](../.github/workflows/pages.yml)がテスト・ビルド・公開を実行します。別の既定ブランチを使う場合は、このファイルの`branches: [main]`を書き換えてください。Actions画面の **Run workflow** でも実行できます。
4. SupabaseをREADMEの手順で設定し、次のGitHub Repository variablesを登録します（`shared/public-config.ts`に公開既定値を用意した場合は省略できます）。接続先は公開ビルドに組み込まれるので、利用者はURLやキーを入力しません。

| Repository variable | 値 |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabaseのpublishable key |

Repository variablesは **Settings → Secrets and variables → Actions → Variables** で追加します。これらはブラウザーに渡す公開設定です。`service_role`、secret key、データベースパスワードは登録しません。

ODPTはアプリの専用トークンを自動で使用します。管理者が差し替える場合は`VITE_ODPT_API_TOKEN`のRepository variableを登録します。ブラウザーで使用するため公開ビルドに含まれます。GTFSを追加する場合は`VITE_GTFS_URLS`へHTTPSのZIP URLを改行区切りで設定します。

## 一般利用者の登録

SupabaseのAuthenticationでメール認証と新規登録を有効にします。利用者はControllerまたはSignageの「新規登録」からアカウントを作成できます。管理者によるUsersへの事前追加は不要です。SignageとControllerは同じアカウントでログインし、他の利用者の端末は表示・操作できません。

メール確認を使う場合は、一般利用者へ確認メールを送れる独自SMTPを設定します。Supabaseの標準メール送信はチームメンバー宛てに制限されているため、そのままでは一般公開の登録に使えません。詳細は[SupabaseのSMTP設定](https://supabase.com/docs/guides/auth/auth-smtp)を参照してください。

Authentication → URL ConfigurationのSite URLは`https://d-tis.com/controller/`、Redirect URLsには`https://d-tis.com/controller/`と`https://d-tis.com/signage/`を登録します。別の公開先ではドメインとリポジトリのサブパスを合わせてください。メール確認後は元の画面へ戻ります。

## 公開されるURL

リポジトリが`https://github.com/example/D-TIS`なら、公開先は次のようになります。

| 画面 | URL |
| --- | --- |
| 案内ページ | `https://example.github.io/D-TIS/` |
| Signage | `https://example.github.io/D-TIS/signage/` |
| Controller | `https://example.github.io/D-TIS/controller/` |

ユーザー用リポジトリ`example.github.io`や独自ドメインでは、`/D-TIS/`部分がなくなります。ワークフローがGitHub Pagesの`base_path`を取得し、画面・画像・フォントのURLを自動調整します。

## ローカル確認

Node.js 22以降を使用します。

```sh
npm ci
npm test
npm run build
npm run preview
```

案内ページは`http://localhost:4173/`、Signageは`http://localhost:4173/signage/`、Controllerは`http://localhost:4173/controller/`です。公開と同じ静的ファイルを確認できます。`npm run dev`は開発用に案内ページ5175、Signage5173、Controller5174で起動します。

リポジトリのサブパスも確認する場合は、`PAGES_BASE`を指定してビルドします。

```powershell
$env:PAGES_BASE = '/D-TIS/'
npm run build
npm run preview
```

```sh
PAGES_BASE=/D-TIS/ npm run build
npm run preview
```

この場合は`http://localhost:4173/D-TIS/`を開きます。プレビューはビルド済みのパスを自動で読みます。

## ビルド成果物

`npm run build`で次の静的パッケージを生成します。

```text
dist/
  index.html
  controller/index.html
  signage/index.html
  assets/                 共有ロゴ・駅ナンバリング
  bundles/               案内ページのJavaScript・CSS・フォント
  .nojekyll
  build-metadata.json
```

各アプリの`bundles/`も各フォルダー内に生成します。GitHub Actionsは`dist/`だけを公開します。`server/`とPi用のインストールスクリプトは以前の構成の資料として残しています。

`*:legacy`コマンドも旧サーバーの資料・診断用です。フロントエンドはクラウド方式へ変更されているため、旧LANアプリ全体を起動するものではありません。

## ブラウザーの結合テスト

ビルド後に`npm run test:e2e`で、静的なSignageとControllerを実際のブラウザーで開いて検証できます。Windowsではインストール済みのChromeを使用します。ほかの環境では、あらかじめ`npx playwright install chromium`を実行するか、`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`に実行ファイルのパスを指定してください。

Supabase Auth・REST・Realtimeはローカルのテスト内で模擬します。運用中のSupabaseや本物のログイン情報は使いません。描画後の記録、Controllerからの再照会、停止・再開、保存エラー時の復元、記録後のHTTP応答喪失からの復旧、ページ更新後の復元、実画面のJPEG転送を確認します。画面共有の取得部分にテスト用canvasを渡し、実際のWebRTCによる映像伝送と停止後の画像への切り替えも確認します。実際のSupabaseへの接続・権限・別ネットワーク間の映像共有は、設定後に別途確認してください。

## 参考

- [GitHub公式：カスタムワークフローでPagesを公開する](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Vite公式：GitHub Pagesへの静的デプロイ](https://vite.dev/guide/static-deploy.html#github-pages)
