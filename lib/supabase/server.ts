import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

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
export async function supabaseServer() {
  const { url, key } = supabaseConfig();
  const store = await cookies();
  return createServerClient(url, key, { global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store', signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) }) }, cookieOptions: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' }, cookies: { getAll: () => store.getAll(), setAll: values => { for (const { name, value, options } of values) store.set(name, value, options); } } });
}
export async function authenticated() {
  const db = await supabaseServer();
  const { data, error } = await db.auth.getUser();
  if (error && (error.name === 'AuthRetryableFetchError' || (error.status ?? 0) >= 500)) throw new ApiError(503, '認証サーバーに接続できません。時間をおいて再試行してください。');
  if (error || !data.user) throw new ApiError(401, 'ログインしてください。');
  const { data: profile, error: profileError } = await db.from('profiles').select('id,is_active').eq('id', data.user.id).maybeSingle();
  if (profileError) throw new ApiError(503, 'メンバー情報を確認できません。接続設定とDBマイグレーションを確認してください。');
  if (!profile?.is_active) throw new ApiError(403, 'このアカウントは利用が許可されていません。管理者に確認してください。');
  return { db, user: data.user };
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
  if (error.code === '42501') return new ApiError(403, '操作する権限がありません。アカウントの有効性を確認してください。');
  if (['22023', '23514', '23503'].includes(error.code ?? '')) return new ApiError(400, '入力内容または担当者が無効です。');
  return new ApiError(503, 'データを保存できませんでした。接続状態とDB設定を確認して再試行してください。');
}
