# michiru

社内チーム向けタスク管理アプリ。Next.js App Router / TypeScript / Tailwind CSS / Radix Dialog / Supabase Auth・PostgreSQLを使用します。

## セットアップ

Node.js 24を使用します。Supabaseプロジェクトを作成し、[接続手順](docs/supabase-setup.md)に従って環境変数・DB・認証メール・メンバーを設定してください。

```sh
npm ci --cache /tmp/michiru-npm-cache
npm run dev
```

環境変数：`SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`、`APP_URL`。`.env.example`を参照してください。service_roleキーは使いません。

## 機能

ログイン・ログアウト、招待時のパスワード設定と再設定、タスクの一覧・登録・詳細編集・完了管理・担当者と状態による絞り込み・検索。PCは表、スマートフォンはカード形式。Supabaseへの保存に成功してから画面を更新します。

DBで有効なメンバーのみ参照可能とし、専用RPCで登録・更新と版の競合検出を行います。未設定時は案内を表示し、サンプルデータやlocalStorageへのフォールバックは行いません。旧UIデモのデータは自動移行しません。

## 検証

```sh
npm run typecheck
npm run build
npm run test:unit
npm run test:api
npm run test:db
npm run test:e2e
```

DBテストにはDocker、E2EテストにはChromiumが必要です。E2EはAPIモックを利用します。実際のSupabase接続・メール配信の確認方法と、各テストの検証範囲は[接続手順](docs/supabase-setup.md)に記載しています。

## 設計

- [要件定義](docs/requirements.md)
- [データベース設計](docs/database-design.md)
- [Supabase接続・運用手順](docs/supabase-setup.md)

## Vercelへの公開

[デプロイ手順](docs/vercel-deployment.md)を参照してください。Next.js / Node.js 24向けの設定を用意しています。Vercelの認証と通信許可が必要です。Supabase未設定のままではタスクを利用できません。
