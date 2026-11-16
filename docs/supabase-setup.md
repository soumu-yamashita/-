# Supabase接続手順（ログイン不要の共有モード）

アプリはURLを知っている人が全タスクを閲覧・登録・編集できる共有モードです。ログイン、招待、パスワード設定、Supabase Authユーザーの作成は不要です。RLSは有効のまま、anon権限に参照と専用RPCの実行を許可します。URLや公開用キー自体を秘密のアクセス資格としては扱いません。

## 1. プロジェクトと環境変数

Supabaseでプロジェクトを作成し、Project SettingsのData API / API KeysからProject URLとPublishable key（またはanon key）を取得します。開発と本番は分離してください。

ローカルでは `.env.example` を元にGit管理外の `.env.local` へ、Vercelではプロジェクトの環境設定へ登録します。

| 変数 | 内容 |
|---|---|
| SUPABASE_URL | `https://<project-ref>.supabase.co` |
| SUPABASE_PUBLISHABLE_KEY | Publishable keyまたはanon key。管理者用のSecret key / service_roleは使わない |
| APP_URL | 利用するアプリのオリジン。開発では `http://localhost:3000`、本番では実際のHTTPS公開URL |

これらはサーバーで読み込みます。`NEXT_PUBLIC_` は付けません。APP_URLは書き込みの送信元検証に使うため、ブラウザーから同じプロトコル・ホスト・ポートでアクセスしてください。送信元の検証は利用者認証の代わりではありません。

ネットワークが制限されている環境では、既存の許可リストを保ってSupabase Project URLのホスト名を追加します。プロジェクト未作成のためホストは未確定です。

## 2. マイグレーション

新規プロジェクトでは、Supabase SQL Editorで以下を**番号順に一度ずつ**実行します。

1. `supabase/migrations/202611160001_initial.sql`
2. `supabase/migrations/202611160002_public_workspace.sql`

最初のマイグレーションだけ適用済みなら、2番目だけを追加適用します。初期マイグレーションは過去の認証付き構成を保持しており、2番目で公開共有モードへ変更します。独自のテーブルやポリシーがある場合は、既存構造との整合を確認してください。

2番目のマイグレーションでは、以下を実施します。

- 既存タスク・担当者・版・作成者を保持する。
- 担当者をAuthユーザーから切り離し、管理者が表示名だけで登録可能にする。
- anon / authenticatedに全タスク・担当者のSELECTを許可する。
- 登録・更新は検証付きの `create_task` / `update_task` RPCだけを許可する。
- 通常のINSERT・UPDATE・DELETE、担当者の管理は引き続き一般利用者に許可しない。
- 新規タスクのcreated_byはNULLにする。ログインしないため操作した人は特定・記録しない。

`private` スキーマはData APIの公開スキーマに追加しません。Data APIでは `public` を公開し、返却行数上限は500以上（既定1,000で可）とします。アプリは500件ずつ取得して集計し、一覧では50件ずつ表示します。

既存データのあるプロジェクトへの追加適用は、そのデータを公開共有モードに切り替える操作です。今回のユーザー指定は「URLを知っている人なら誰でも閲覧・編集できる」です。

## 3. 担当者の登録

Supabase SQL Editorの管理者権限で実際の担当者名を登録します。Authユーザーやメールアドレスは不要です。

```sql
INSERT INTO public.profiles (display_name, is_active)
VALUES ('担当者名', true)
RETURNING id, display_name;
```

担当者が0人の間も一覧は開けますが、新規登録は無効になります。実際に割り当てる担当者を少なくとも1名登録してください。名前を登録しても、その人物だけがアクセスできるようになるわけではありません。

新規の割り当てを止める場合：

```sql
UPDATE public.profiles SET is_active = false WHERE id = '対象担当者のUUID'::uuid;
```

既存タスク・担当者名は残ります。既存タスクの編集・完了・再割り当ては可能です。`is_active`は新規割り当て可否だけを制御し、閲覧者のアクセス可否には使いません。

## 4. 起動・動作確認

```sh
npm ci --cache /tmp/michiru-npm-cache
npm run dev
```

環境変数の変更後はサーバーを再起動します。依存関係の再インストールやビルドの前には、自分が起動したサーバーを停止してください。

接続後は以下を確認します。

1. 新しいブラウザーで `/` を直接開き、ログインなしで一覧を取得できる。
2. タスクの登録・編集・完了・未完了への復帰と、再読み込み後の保持を確認する。
3. 別ブラウザーでも同じタスクを取得できる。他の人の変更は「一覧を再取得」またはフォーカス復帰で確認する。
4. 同じタスクを2画面で開き、一方の保存後にもう一方の保存が版の競合で拒否される。
5. `/login`・`/password`・旧招待URLが一覧へ移動し、認証画面を表示しない。

未設定・通信失敗時は接続案内を表示し、サンプルデータやlocalStorageへは切り替えません。旧UIデモのlocalStorageデータは自動移行・削除しません。保存結果が不明な場合は、二重登録を避けるため再取得後に再試行してください。

## 5. テストの範囲

```sh
npm run typecheck
npm run build
npm run test:unit
npm run test:api
npm run test:db
npm run test:e2e
```

- unit：入力制約・DB→UI変換。
- api：ビルド済みNext.jsの実APIと実Supabase SDKを通す。PostgRESTのHTTP境界はfixtureで再現。ログイン・Cookieなしのアクセス、RPC、競合を検証。先にbuildが必要。
- db：Dockerの一時PostgreSQL 17で、両マイグレーション、既存データ保持、anonロールのアクセス、RLS・RPC・並行更新を検証。初期マイグレーション用Authスキーマのみfixture。終了時にコンテナーを削除。
- e2e：Playwrightで画面操作。APIはモック。Chromiumは `/usr/bin/chromium` または `CHROMIUM_PATH`。

これらは実Supabase/PostgRESTへの接続確認を代替しません。実プロジェクトへの適用・接続は未実施です。
