# michiru

社内チーム向けタスク管理アプリ。Next.js App Router / TypeScript / Tailwind CSS / Radix Dialog / Supabase PostgreSQLを使用します。

## セットアップ

Node.js 24を使用します。Supabaseプロジェクトを作成し、[接続手順](docs/supabase-setup.md)に従って環境変数・DB・担当者を設定してください。

```sh
npm ci --cache /tmp/michiru-npm-cache
npm run dev
```

環境変数：`SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`、`APP_URL`。`.env.example`を参照してください。service_roleキーは使いません。

## 機能

ログイン不要で、URLを知っている人が全タスクを閲覧・登録・編集・完了にできる共有アプリです。担当者と状態による絞り込み・タイトル検索に対応。PCは表、スマートフォンはカード形式です。

RLSは有効のまま、公開用のanon権限で参照・専用RPC実行を許可します。更新は版の競合を検出し、保存成功後に画面へ反映します。担当者は管理者が登録し、Authユーザーは不要。旧ログイン・パスワードURLは一覧へ移動します。

既存DBには追加マイグレーション `202611160002_public_workspace.sql` を適用してください。データは保持したまま公開共有モードへ変更します。未設定時は接続案内を表示し、localStorageへのフォールバックは行いません。

## 検証

```sh
npm run typecheck
npm run build
npm run test:unit
npm run test:api
npm run test:db
npm run test:e2e
```

DBテストにはDocker、E2EテストにはChromiumが必要です。E2EはAPIモックを利用します。実際のSupabase接続・共有モードの確認方法と、各テストの検証範囲は[接続手順](docs/supabase-setup.md)に記載しています。

## 設計

- [要件定義](docs/requirements.md)
- [データベース設計](docs/database-design.md)
- [Supabase接続・運用手順](docs/supabase-setup.md)

## Vercelへの公開

[デプロイ手順](docs/vercel-deployment.md)を参照してください。Next.js / Node.js 24向けの設定を用意しています。Vercelの認証と通信許可が必要です。Supabase未設定のままではタスクを利用できません。
