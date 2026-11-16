'use client';
import { useEffect, useState } from 'react';
import { Leaf, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
export default function AuthForm({ password = false }: { password?: boolean }) {
  const [reset, setReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [link, setLink] = useState<{ token_hash: string; type: string } | null>(null);
  useEffect(() => { const params = new URLSearchParams(location.search); if (params.has('error')) setError('リンクが無効です。管理者に再招待または再設定を依頼してください。'); const token_hash = params.get('token_hash'); const type = params.get('type'); if (password && token_hash && type) { setLink({ token_hash, type }); history.replaceState(null, '', '/password'); } }, [password]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busy) return; const form = new FormData(e.currentTarget); setBusy(true); setError(''); setMessage('');
    try {
      if (password && form.get('password') !== form.get('confirmation')) throw Error('確認用パスワードが一致しません。');
      if (password && link) { const res = await fetch('/auth/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(link) }); const data = await res.json(); if (!res.ok) throw Error(data.error); setLink(null); }
      const action = password ? 'password' : reset ? 'reset' : 'login';
      const body = password ? { password: form.get('password') } : reset ? { email: form.get('email') } : { email: form.get('email'), password: form.get('password') };
      const res = await fetch(`/api/auth/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const data = await res.json(); if (!res.ok) throw Error(data.error);
      if (reset) setMessage('登録されている場合は、再設定メールが届きます。メールをご確認ください。');
      else location.assign(password ? '/login?updated=1' : '/');
    } catch (e) { setError(e instanceof Error ? e.message : '接続できませんでした。再試行してください。'); } finally { setBusy(false); }
  }
  return <main className="auth-page"><div className="auth-card"><Link href="/" className="brand"><span className="brand-mark"><Leaf size={24} /></span>michiru<span className="brand-dot">.</span></Link><div className="auth-intro"><h1>{password ? 'パスワードを設定' : reset ? 'パスワードの再設定' : 'おかえりなさい'}</h1><p>{password ? '12文字以上の新しいパスワードを設定してください。' : reset ? '登録したメールアドレスを入力してください。' : 'チームの次の一歩を、ここから。'}</p></div><form onSubmit={submit}>{!password && <><label htmlFor="email" className="form-label">メールアドレス</label><input id="email" name="email" type="email" required autoComplete="email" maxLength={254} placeholder="name@company.jp" /></>}{(!reset || password) && <><label htmlFor="password" className="form-label">{password ? '新しいパスワード' : 'パスワード'}</label><input id="password" name="password" type="password" required minLength={password ? 12 : 1} maxLength={256} autoComplete={password ? 'new-password' : 'current-password'} /></>}{password && <><label htmlFor="confirmation" className="form-label">パスワード（確認）</label><input id="confirmation" name="confirmation" type="password" required minLength={12} maxLength={256} autoComplete="new-password" /></>}{error && <p role="alert" className="form-error">{error}</p>}{message && <p role="status" className="form-message">{message}</p>}<Button type="submit" disabled={busy}>{busy ? '処理中…' : password ? 'パスワードを保存' : reset ? '再設定メールを送信' : 'ログイン'}</Button></form>{!password && <button className="auth-reset" onClick={() => { setReset(!reset); setError(''); setMessage(''); }}>{reset ? <><ArrowLeft size={14} />ログインに戻る</> : 'パスワードをお忘れですか？'}</button>}{password && <Link href="/login" className="auth-reset">ログインへ戻る</Link>}<p className="auth-note">招待された社内メンバーのみ利用できます。</p></div></main>;
}
