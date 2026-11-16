# Supabaseへの接続手順

現在のアプリはSupabase Auth / PostgreSQLへの接続コードを実装済みです。ローカルのサンプルデータやlocalStorageには切り替わりません。Supabaseプロジェクトの作成、設定、マイグレーション適用は以下の手順で行います。

## 1. プロジェクトと環境変数

1. Supabaseで開発用プロジェクトを作成します。本番環境とは分離してください。
2. Project SettingsのData API / API KeysでProject URLとPublishable keyを取得します。従来のanon keyも利用できます。service_role / Secret keyはアプリに設定しません。
3. ローカル開発では `.env.example` を元に、Git管理外の `.env.local` に以下を設定します。クラウド環境・Vercelでは環境設定から登録します。

| 変数 | 内容 |
|---|---|
| SUPABASE_URL | Project URL（`https://<project-ref>.supabase.co`） |
| SUPABASE_PUBLISHABLE_KEY | Publishable key（`sb_publishable_...`）またはanon key |
| APP_URL | アプリのURL。ローカル開発では `http://localhost:3000`、本番ではHTTPSの公開URL |

ブラウザーではAPP_URLと同じオリジン（プロトコル・ホスト・ポート）からアクセスしてください。書き込みリクエストの送信元をこのURLで検証します。

これらの変数はサーバーで読み込みます。`NEXT_PUBLIC_` は付けません。Supabaseのユーザーセッションもサーバーで管理し、HttpOnly Cookieに保持します。通常のタスク操作で管理者用キーを使いません。

クラウド環境のネットワークが制限されている場合、既存の許可リストを保ったまま、Project URLの**ホスト名そのもの**を追加してください。プロジェクト未作成のため、接続先ホストは現時点では未確定です。カスタムドメインを利用する場合はそのホストを許可します。

## 2. データベースの作成

Supabase DashboardのSQL Editorで、次のファイルの内容を確認して一度だけ実行します。

`supabase/migrations/202611160001_initial.sql`

このマイグレーションは新規プロジェクトを対象とします。既存の `profiles` / `tasks` があるプロジェクトではそのまま実行せず、既存構造と整合する移行を設計してください。トランザクションでテーブル・制約・RLS・RPCをまとめて作成します。

作成されるもの：

- `public.profiles`：表示名、利用可否。
- `public.tasks`：タスク内容、担当者、期限、完了日時、版。
- `public.create_task` / `public.update_task`：認証・有効性・入力検証を行う書き込みRPC。
- `private` スキーマ：RLSの有効性確認などの内部関数。Data APIの公開スキーマに追加しないでください。

Data APIでは `public` を公開し、APIの最大返却行数は500以上（既定の1,000で可）とします。アプリは500件ずつ全件を取得して集計し、画面では50件ずつ表示します。初期想定はタスク10,000件までです。将来の大規模運用では、DBでの集計・サーバー側フィルター方式に変更します。

## 3. 認証とメール

Supabase Authenticationの設定で以下を行います。

- Email / Password認証を有効にします。
- 新規ユーザーのサインアップを無効にします。アプリには公開登録画面を提供しません。
- Site URLを `APP_URL` と同じ値にします。
- Redirect URLsに開発用・本番用それぞれの `/password` を明示的に登録します。例：`http://localhost:3000/password`。本番では広範なワイルドカードを避けます。
- パスワードの最小長を12文字以上にします。その他の社内セキュリティ要件も反映してください。
- 本番向けSMTPと送信元を設定し、招待・再設定メールの配信を確認します。

Email Templatesで、**Invite user**のリンクを以下に設定します。

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite">パスワードを設定する</a>
```

**Reset password**のリンクも次に設定します。

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery">パスワードを再設定する</a>
```

このアプリは、メールリンクから `token_hash` を受け取る方式です。既定の `ConfirmationURL` やURLフラグメントのトークンをそのまま使う方式ではありません。リンク先のフォームで保存したときにトークンを確認するため、メールの先読みだけではトークンを消費しません。転送先は固定の `/password` で、任意の外部URLは受け付けません。

ブラウザーが受け取ったトークンはURLから除去してメモリー内でのみ保持します。送信前にページを再読み込みした場合はメールのリンクを開き直してください。

## 4. メンバーの招待と有効化

1. Authenticationのユーザー管理から社内メンバーを招待します。
2. 対象ユーザーのUUIDを取得します。
3. SQL Editor（管理者権限）でprofiles行を作成します。次のUUIDと表示名を実際の対象者に置き換えてください。

```sql
INSERT INTO public.profiles (id, display_name, is_active)
VALUES ('招待したユーザーのUUID'::uuid, '表示名', true);
```

Authユーザーがいるだけではタスクにはアクセスできません。profilesが未登録または無効の場合はアクセスを拒否します。一般メンバーからのprofilesの登録・編集・削除も拒否します。

招待メールが先に届いた場合、パスワードの設定はできますが、profilesの有効化完了までログイン後のアプリ利用はできません。有効化完了を確認して案内してください。

利用停止は次で行います。Authユーザーやprofilesは削除しません。

```sql
UPDATE public.profiles SET is_active = false WHERE id = '対象ユーザーのUUID'::uuid;
```

無効化後に始まるデータ操作は、既存セッションでも拒否されます。無効化前に送信済み・表示済みのデータを回収する機能ではありません。担当済みタスクは残り、有効メンバーが編集・再割り当てできます。

## 5. 起動と接続確認

```sh
npm ci --cache /tmp/michiru-npm-cache
npm run dev
```

環境変数の変更後は開発サーバーを再起動してください。実行中のサーバーを止めてから依存関係の再インストールや本番ビルドを行います。

接続後は以下を実際の開発プロジェクトで確認します。

1. 招待メールから初回パスワードを設定し、ログインする。
2. 一覧が空であることを確認し、タスクを登録する。
3. 編集、完了、未完了への復帰、再読み込み後の保持を確認する。
4. 別の招待メンバーが同じタスクを取得できることを確認する。他のメンバーの変更は再取得ボタンまたはウィンドウへのフォーカス復帰で反映される。リアルタイム同期は行わない。
5. 同じタスクを2つの画面で開き、一方の保存後にもう一方が競合として拒否されることを確認する。
6. 無効メンバー・未認証の利用者からデータを取得・変更できないことを確認する。
7. パスワード再設定メールを要求し、リンクの有効時・無効時の動作を確認する。
8. ログアウトし、データ取得が拒否されることを確認する。

保存失敗時は入力を残します。通信断で保存結果が分からないときは、二重登録を避けるため一覧を再取得してから再試行してください。旧UIデモのlocalStorageデータは自動移行・削除しません。

## 6. 自動テストと検証範囲

```sh
npm run typecheck
npm run build
npm run test:unit
npm run test:api
npm run test:db
npm run test:e2e
```

- `test:unit`：入力検証とDB→UI変換。
- `test:api`：ビルド後の実際のNext.js APIとSupabase SDKを使用し、認証Cookie・データ変換・RPC呼び出し・競合応答を検証。AuthとPostgRESTのHTTP応答はfixtureで再現し、実プロジェクトには接続しない。先に `npm run build` を実行する。
- `test:db`：Dockerで一時的なPostgreSQL 17を起動し、実際のマイグレーション・RLS・RPCを検証。Authのユーザーテーブルと `auth.uid()` の境界のみfixtureで再現。テスト用DBはループバックにのみ公開し、終了時にコンテナーごと削除する。Dockerと固定digestの公式PostgreSQLイメージが必要。
- `test:e2e`：Playwrightによる画面操作。Supabaseプロジェクト不要で動かすためAPI応答をモックする。別オリジン拒否のテストは実際のNext.jsハンドラーを呼び出す。Chromiumは `/usr/bin/chromium` または `CHROMIUM_PATH` を使用する。

これらは、実際のSupabase Auth・メール配信・PostgREST接続を検証したことを意味しません。上記の実プロジェクトでの接続確認が別途必要です。テスト実行時に本番環境の情報は不要です。
