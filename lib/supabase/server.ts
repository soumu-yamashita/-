import 'server-only';
import { createClient } from '@supabase/supabase-js';

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export function supabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new ApiError(503, 'Supabaseの接続設定が必要です。管理者に設定を依頼してください。');
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new ApiError(503, 'Supabaseの接続URLが正しく設定されていません。'); }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) throw new ApiError(503, 'Supabaseの接続URLにはHTTPSが必要です。');
  if (key.startsWith('sb_secret_')) throw new ApiError(503, 'Publishable keyを設定してください。管理者用キーは使用できません。');
  if (key.split('.').length === 3) { try { if (JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role !== 'anon') throw new Error(); } catch { throw new ApiError(503, 'anon keyまたはPublishable keyを設定してください。'); } }
  return { url, key };
}
export function supabaseServer() {
  const { url, key } = supabaseConfig();
  // 公開共有モード。利用者のCookieやJWTを引き継がず、常にanon権限でアクセスする。
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store', signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) }) } });
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  // 本番プロキシ背後ではrequest.urlが内部ホストになるため、設定済みの公開URLを基準にする。
  let expected: string;
  try { expected = new URL(process.env.APP_URL || request.url).origin; } catch { throw new ApiError(503, 'APP_URLの設定を確認してください。'); }
  if (!origin || origin !== expected) throw new ApiError(403, 'この送信元からの操作は許可されていません。');
}
export function response(data: unknown, status = 200) { return Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } }); }
export function failure(error: unknown) { return response({ error: error instanceof ApiError ? error.message : '処理に失敗しました。時間をおいて再試行してください。' }, error instanceof ApiError ? error.status : 500); }
export function databaseError(error: { code?: string }) {
  if (error.code === 'PT409') return new ApiError(409, '別のメンバーが更新しました。入力内容を控え、一覧を再取得してから編集し直してください。');
  if (error.code === 'PT404') return new ApiError(404, 'タスクが見つかりません。');
  if (error.code === '42501') return new ApiError(403, '操作する権限がありません。共有モードのDBマイグレーションを確認してください。');
  if (['22023', '23514', '23503'].includes(error.code ?? '')) return new ApiError(400, '入力内容または担当者が無効です。');
  return new ApiError(503, 'データを保存できませんでした。接続状態とDB設定を確認して再試行してください。');
}
