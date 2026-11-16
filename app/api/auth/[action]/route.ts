import { ApiError, authenticated, failure, response, sameOrigin, supabaseServer } from '@/lib/supabase/server';
import { emailInput, loginInput, passwordInput } from '@/lib/validation';
export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  try {
    sameOrigin(request);
    const { action } = await context.params;
    const db = await supabaseServer();
    if (action === 'logout') {
      const { error } = await db.auth.signOut({ scope: 'local' });
      if (error) throw new ApiError(503, 'ログアウトできませんでした。再試行してください。');
      return response({ ok: true });
    }
    const json = await request.json().catch(() => { throw new ApiError(400, '入力形式が正しくありません。'); });
    if (action === 'login') {
      const parsed = loginInput.safeParse(json);
      if (!parsed.success) throw new ApiError(400, 'メールアドレスとパスワードを確認してください。');
      const { error } = await db.auth.signInWithPassword(parsed.data);
      if (error) throw new ApiError(401, 'ログインできませんでした。入力内容を確認して再試行してください。');
      try { await authenticated(); } catch (error) { await db.auth.signOut({ scope: 'local' }); throw error; }
      return response({ ok: true });
    }
    if (action === 'reset') {
      const parsed = emailInput.safeParse(json);
      if (!parsed.success) throw new ApiError(400, 'メールアドレスを確認してください。');
      const appUrl = process.env.APP_URL;
      if (!appUrl || !/^https?:\/\//.test(appUrl)) throw new ApiError(503, '管理者によるAPP_URLの設定が必要です。');
      const { error } = await db.auth.resetPasswordForEmail(parsed.data.email, { redirectTo: new URL('/password', appUrl).toString() });
      if (error) throw new ApiError(503, '再設定メールを送信できませんでした。時間をおいて再試行してください。');
      return response({ ok: true });
    }
    if (action === 'password') {
      const parsed = passwordInput.safeParse(json);
      if (!parsed.success) throw new ApiError(400, 'パスワードは12〜256文字で入力してください。');
      const { data, error: userError } = await db.auth.getUser();
      if (userError || !data.user) throw new ApiError(401, '設定リンクが無効または期限切れです。もう一度メールを取得してください。');
      const { error } = await db.auth.updateUser(parsed.data);
      if (error) throw new ApiError(400, 'パスワードを更新できませんでした。別のパスワードで再試行してください。');
      await db.auth.signOut({ scope: 'local' });
      return response({ ok: true });
    }
    throw new ApiError(404, '操作が見つかりません。');
  } catch (error) { return failure(error); }
}
