# Vercelへのデプロイ

## 現在の状態

- GitHubリポジトリ：`soumu-yamashita/-`、本番対象ブランチ：`main`。
- Next.jsとNode.js 24を使用。`vercel.json`でビルド・インストール設定を指定。
- Supabaseプロジェクトは未作成。現状でもビルドは可能だが、公開後のタスク利用にはSupabaseの設定が必要。
- Vercelへのデプロイ完了・公開URLはまだ確認されていない。

## GitHubから公開する場合

1. [Vercel](https://vercel.com/new)にログインし、既存Gitリポジトリのインポートで `soumu-yamashita/-` を選ぶ。リポジトリが見えない場合はVercelのGitHub連携にこのリポジトリへのアクセスを付与する。
2. 公開先のアカウント／チームを選び、プロジェクト名を `michiru-task-manager` などにする。リポジトリ名の `-` をそのままプロジェクト名に使わない。
3. Framework Presetを **Next.js**、Root Directoryをリポジトリ直下にする。Node.jsは **24.x**。Build Commandは `npm run build`、Install Commandは `npm ci`。Output Directoryは上書きしない。
4. Supabaseが用意済みであれば、下記の環境変数を登録してDeployする。未作成のままDeployした場合、サイトでは接続設定の案内が表示される。
5. 発行された本番ドメインを確認し、`APP_URL`にそのHTTPS URLを設定する。環境変数を変更した場合は再デプロイする。
6. ログイン画面と、設定済みのSupabaseを通したタスクの操作を確認する。

VercelとGitHubの連携後は、`main`へのpushを本番デプロイの起点として使える。初回公開後、Git設定でProduction Branchが `main` であることを確認する。

## 必要なアプリ環境変数

| 名前 | 内容 |
|---|---|
| SUPABASE_URL | Supabase Project URL |
| SUPABASE_PUBLISHABLE_KEY | Publishable key、またはanon key。service_roleは使用しない |
| APP_URL | 本番のHTTPS URL（例示のドメインをそのまま使わず、実際に発行されたURLを設定する） |

アプリの環境変数はVercel側のProduction環境に登録する。このクラウド環境に登録した値は、自動的にVercelへ同期されない。Preview環境も利用する場合は、開発用Supabaseを分け、アクセスするURLに合うAPP_URLを設定する。

`APP_URL`は書き込みの送信元検証とパスワード再設定リンクの転送先に使う。アプリはこのURLと同じオリジンから利用する。本番で `http://localhost:3000` を設定しない。

SupabaseのSite URLとRedirect URLs、および招待・再設定メールのテンプレートも本番URLに合わせて設定する。[Supabase接続手順](supabase-setup.md)のDB作成・メンバー登録を完了する。

## このクラウド環境からCLIで公開する場合

次の前提が必要。

- `api.vercel.com`、`vercel.com`、`auth.vercel.com`への通信許可。
- Vercelアカウントの認証。既存のログイン、または安全に登録した `VERCEL_TOKEN` を利用する。
- 公開先アカウント／チームへのプロジェクト作成・デプロイ権限。

通信許可とトークン要件はクラウド環境設定の下書きに保存済み。下書きの保存だけでは、実行中環境の通信設定や認証には反映されない。環境設定で確認・保存し、環境を公開した後に接続と認証を再確認する。

この環境ではCLIを `/tmp/michiru-vercel-cli` にインストールした。CLIのグローバル設定ディレクトリには書き込み可能な `/tmp/michiru-vercel-config` を使う。これらのパスは一時的であり、新しい環境での保持は前提にしない。CLIを再導入する場合もアプリのdependenciesには追加しない。

認証と通信が利用可能になったら、次の順で実施する。

1. Vercelのアカウント・チームを確認する。
2. 既存プロジェクトがないか確認し、同じアプリの重複作成を避ける。
3. プロジェクトをリンクまたは作成し、Node.js・環境変数を設定する。
4. `vercel deploy --prod` で公開し、ビルド完了を確認する。
5. 公開URLのHTTP応答、ログイン画面、Supabaseを通す操作を確認する。Deployment Protectionがある場合は、認証された経路で確認し、保護を解除して回避しない。

トークンはチャット・ソース・ログへ出力しない。`VERCEL_TOKEN`はデプロイツール用で、アプリのVercel環境変数には登録する必要はない。`.vercel/`、`.env.local`、依存関係、ビルド出力はGitに保存しない。
