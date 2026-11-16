import { NextResponse } from 'next/server';
import { supabaseServer, sameOrigin, response, ApiError, failure } from '@/lib/supabase/server';
// メールのリンクを開いただけではトークンを消費しない。メールスキャナーの先読みを避ける。
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  if (!token || !['invite', 'recovery'].includes(type ?? '')) return NextResponse.redirect(new URL('/login?error=link', url));
  const target = new URL('/password', url);
  target.searchParams.set('token_hash', token);
  target.searchParams.set('type', type!);
  return NextResponse.redirect(target, { headers: { 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' } });
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { token_hash, type } = await request.json();
    if (typeof token_hash !== 'string' || token_hash.length > 512 || !['invite', 'recovery'].includes(type)) throw new ApiError(400, 'リンクが正しくありません。');
    const db = await supabaseServer();
    const { error } = await db.auth.verifyOtp({ token_hash, type });
    if (error) throw new ApiError(401, 'リンクが無効または期限切れです。メールを再取得してください。');
    return response({ ok: true });
  } catch (error) { return failure(error); }
}
