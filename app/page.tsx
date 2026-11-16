'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Member, Task, Workspace } from '@/lib/types';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowDown, ArrowRight, CalendarDays, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, LayoutGrid, Leaf, ListTodo, Menu, MoreHorizontal, Plus, Search, Sparkles, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

type View = 'all' | 'done';
const MemberContext = createContext<Member[]>([]);
function today() { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()); }
function Avatar({ id, small = false }: { id: string; small?: boolean }) { const members = useContext(MemberContext); const index = members.findIndex(m => m.id === id); const m = members[index]; return <span className={`avatar ${['sage', 'blue', 'pink', 'sand'][Math.max(index, 0) % 4]} ${small ? 'small' : ''}`} aria-hidden="true">{m?.name.slice(0, 1) ?? '?'}</span>; }
class RequestError extends Error { constructor(public status: number, message: string) { super(message); } }
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try { res = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(20000) }); } catch { throw new RequestError(0, '接続できませんでした。操作結果が不明な場合は、一覧を再取得してから再試行してください。'); }
  const data = await res.json().catch(() => ({ error: '応答を確認できませんでした。一覧を再取得してください。' }));
  if (!res.ok) { throw new RequestError(res.status, data.error || '処理に失敗しました。'); }
  return data as T;
}
function dateLabel(date: string) { const [, m, d] = date.split('-'); return `${Number(m)}月${Number(d)}日`; }

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>('all');
  const [status, setStatus] = useState('todo');
  const [assignee, setAssignee] = useState('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [notice, setNotice] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const loadSequence = useRef(0);
  const [teamOpen, setTeamOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [page, setPage] = useState(1);
  const addButton = useRef<HTMLButtonElement>(null);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    try {
      const data = await api<Workspace>('/api/workspace');
      if (sequence !== loadSequence.current) return;
      setTasks(data.tasks); setMembers(data.members); setLoaded(true); setLoadError('');
    } catch (e) {
      if (sequence !== loadSequence.current) return;
      setLoadError(e instanceof Error ? e.message : '取得できませんでした。');
      if (e instanceof RequestError && [401, 403].includes(e.status)) { setTasks([]); setMembers([]); setLoaded(false); }
    } finally { if (sequence === loadSequence.current) setReady(true); }
  }, []);
  useEffect(() => { void load(); const onFocus = () => { if (!busyRef.current) void load(); }; window.addEventListener('focus', onFocus); return () => { loadSequence.current++; window.removeEventListener('focus', onFocus); }; }, [load]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { setPage(1); }, [query, assignee, status, view]);
  const incomplete = tasks.filter(t => !t.done);
  const finished = tasks.filter(t => t.done).length;
  const overdue = incomplete.filter(t => t.due < today()).length;
  const dueToday = incomplete.filter(t => t.due === today()).length;
  const percent = tasks.length ? Math.round(finished / tasks.length * 100) : 0;
  const visible = tasks.filter(t => (view === 'done' ? t.done : status === 'all' || t.done === (status === 'done')) && (assignee === 'all' || t.assignee === assignee) && t.title.toLowerCase().includes(query.toLowerCase())).sort((a, b) => a.due.localeCompare(b.due) || b.created - a.created || a.id.localeCompare(b.id));
  useEffect(() => { setPage(p => Math.min(p, Math.max(1, Math.ceil(visible.length / 50)))); }, [visible.length]);
  const pageTasks = visible.slice((page - 1) * 50, page * 50);
  const title = view === 'done' ? '完了したタスク' : 'すべてのタスク';
  function changeView(v: View) { setView(v); setStatus(v === 'done' ? 'done' : 'todo'); setAssignee('all'); setQuery(''); setMobileMenu(false); }
  async function persist(data: { title: string; description: string; assignee: string; due: string; done: boolean }, task: Task | null) {
    return api<Task>('/api/tasks', { method: task ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(task ? { ...data, id: task.id, version: task.version } : data) });
  }
  async function toggle(task: Task) {
    if (busyRef.current) return;
    busyRef.current = true; loadSequence.current++; setBusy(true); setSaveError('');
    try { const result = await persist({ title: task.title, description: task.description, assignee: task.assignee, due: task.due, done: !task.done }, task); setTasks(prev => prev.map(t => t.id === result.id ? result : t)); setNotice(result.done ? 'タスクを完了しました。おつかれさまです！' : 'タスクを未完了に戻しました'); }
    catch (e) { setSaveError(e instanceof Error ? e.message : '保存できませんでした。'); if (e instanceof RequestError && e.status === 409) await load(); }
    finally { busyRef.current = false; setBusy(false); }
  }
  function startCreate() { setEditing(null); setSaveError(''); setOpen(true); }
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busyRef.current) return;
    const f = new FormData(e.currentTarget); const title = String(f.get('title')).trim();
    if (!title) { const input = e.currentTarget.elements.namedItem('title') as HTMLInputElement; input.setCustomValidity('タスク名を入力してください'); input.reportValidity(); return; }
    busyRef.current = true; loadSequence.current++; setBusy(true); setSaveError('');
    const data = { title, description: String(f.get('description')).trim(), assignee: String(f.get('assignee')), due: String(f.get('due')), done: f.get('done') === 'on' };
    try { const result = await persist(data, editing); setTasks(prev => editing ? prev.map(t => t.id === result.id ? result : t) : [...prev, result]); setOpen(false); setNotice(editing ? 'タスクを更新しました' : '新しいタスクを登録しました'); }
    catch (e) { setSaveError(e instanceof Error ? e.message : '保存できませんでした。'); if (e instanceof RequestError && e.status === 409) await load(); }
    finally { busyRef.current = false; setBusy(false); }
  }
  const activeMembers = members.filter(m => m.active);
  if (!ready || !loaded) return <main><section className="connection-state"><Leaf size={30} /><h1>{!ready ? 'ワークスペースを読み込み中' : 'ワークスペースに接続できません'}</h1><p role={loadError ? 'alert' : undefined}>{loadError || 'チームのデータを確認しています。'}</p>{ready && <><Button onClick={() => { setReady(false); void load(); }}>再試行</Button><p>初めて利用する場合は、管理者に接続設定とメンバー登録を依頼してください。</p></>}</section></main>;
  return <MemberContext.Provider value={members}><div className="app-shell">
    {mobileMenu && <button className="mobile-shade" aria-label="メニューを閉じる" onClick={() => setMobileMenu(false)} />}
    <aside className={`sidebar ${mobileMenu ? 'is-open' : ''}`}>
      <a className="brand" href="/" aria-label="michiru ホーム"><span className="brand-mark"><Leaf size={23} /></span>michiru<span className="brand-dot">.</span></a>
      <div className="workspace-label"><span className="workspace-icon"><Users size={17} /></span><div>チームワークスペース<small>TEAM WORKSPACE</small></div><span className="workspace-badge">{members.filter(m => m.active).length}人</span></div>
      <div className="nav-label">ワークスペース</div>
      <nav aria-label="メインナビゲーション">
        <button className={view === 'all' ? 'nav-item active' : 'nav-item'} onClick={() => changeView('all')}><LayoutGrid size={18} />すべてのタスク<span>{incomplete.length}</span></button>

        <button className={view === 'done' ? 'nav-item active' : 'nav-item'} onClick={() => changeView('done')}><CheckCheck size={18} />完了したタスク</button>
        <div className="nav-divider" />
        <button className="nav-item" onClick={() => setTeamOpen(true)}><Users size={18} />チームメンバー<span className="plain-count">{members.filter(m => m.active).length}</span></button>
      </nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><span className="note-icon"><Sparkles size={20} /></span><strong>小さな一歩を、チームで。</strong><p>今日の「できた」が、<br />明日のチームをつくります。</p><span className="note-decoration" aria-hidden="true"><Leaf size={112} strokeWidth={0.7} /></span></div><button className="help-link" onClick={() => setHelpOpen(true)}><CircleHelp size={17} />使い方・ヘルプ<ArrowRight size={15} /></button><div className="profile"><span className="avatar sage" aria-hidden="true"><Users size={17} /></span><div><strong>共有ワークスペース</strong><small>みんなのタスクをひとつに</small></div></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-toggle" aria-label="メニューを開く" onClick={() => setMobileMenu(true)}><Menu size={20} /></button><span>ワークスペース</span><ChevronRight size={14} /><strong>{title}</strong></div><div className="topbar-right"><span className="demo-indicator"><i />チームワークスペース</span><span className="topbar-divider" /><span className="avatar sage small" aria-hidden="true"><Users size={14} /></span></div></header>
      <main>
        {loadError && <p role="alert" className="form-error">{loadError}</p>}
        {!activeMembers.length && <p role="status" className="form-message">担当者が未登録です。タスクを登録する前に、管理者に担当者の追加を依頼してください。</p>}
        {saveError && !open && <p role="alert" className="form-error">{saveError}</p>}
        <div className="page-heading"><div><div className="eyebrow">TEAM TASKS <span>／</span> チームのやること</div><h1>{title}<span className="heading-dot">.</span></h1><p>やることを明確に。チームの毎日を、少しスムーズに。</p></div><Button onClick={startCreate} disabled={!activeMembers.length}><Plus size={18} />新規タスク</Button></div>
        <section className="overview" aria-label="チームの進捗">
          <div className="stat-card"><span className="stat-icon green"><ListTodo size={19} /></span><div><span className="stat-label">未完了のタスク</span><div className="stat-number">{incomplete.length}<small>件</small></div></div><span className="stat-caption">チーム全体</span></div>
          <div className="stat-card"><span className="stat-icon amber"><CalendarDays size={19} /></span><div><span className="stat-label">今日が期限</span><div className="stat-number">{dueToday}<small>件</small></div></div><span className="stat-caption">今日のうちに</span></div>
          <div className="stat-card"><span className="stat-icon rose"><Clock3 size={19} /></span><div><span className="stat-label">期限超過</span><div className="stat-number overdue-number">{overdue}<small>件</small></div></div><span className="stat-caption">確認しましょう</span></div>
          <div className="progress-card"><div className="progress-top"><span>チームの完了率</span><span><strong>{percent}</strong> %</span></div><div className="progress-track"><div style={{ width: `${percent}%` }} /></div><div className="progress-bottom"><span>{tasks.length}件中 {finished}件が完了</span><span>いいペースです <Sparkles size={12} /></span></div></div>
        </section>
        <section className="task-panel" aria-label="タスク一覧">
          <div className="panel-heading"><div className="panel-title"><ListTodo size={18} /><h2>タスク一覧</h2><span className="count-chip">{visible.length}</span></div><div className="sync-controls"><button onClick={() => { if (!busy) void load(); }} disabled={busy}>一覧を再取得</button><span className="autosave"><span />Supabaseに保存</span></div></div>
          <div className="toolbar"><div className="filters"><div className="select-wrap"><Users size={15} /><select aria-label="担当者で絞り込み" value={assignee} onChange={e => setAssignee(e.target.value)}><option value="all">すべての担当者</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select><ChevronDown size={14} /></div><div className="select-wrap"><span className={`status-dot ${status === 'done' ? 'complete' : ''}`} /><select aria-label="状態で絞り込み" value={view === 'done' ? 'done' : status} disabled={view === 'done'} onChange={e => setStatus(e.target.value)}><option value="todo">未完了</option><option value="done">完了</option><option value="all">すべての状態</option></select><ChevronDown size={14} /></div></div><label className="search-field"><Search size={16} /><input aria-label="タスクを検索" placeholder="タスクを検索..." value={query} onChange={e => setQuery(e.target.value)} />{query && <button aria-label="検索をクリア" onClick={() => setQuery('')}><X size={14} /></button>}</label></div>
          <div className="table-scroll"><table><thead><tr><th className="check-column"><span className="tiny-square" /></th><th>タスク名</th><th className="assignee-column">担当者</th><th className="due-column">期限 <ArrowDown size={12} /></th><th className="status-column">ステータス</th><th className="action-column"><span className="sr-only">編集</span></th></tr></thead><tbody>{ready && pageTasks.map(task => <tr key={task.id} className={task.done ? 'task-done' : ''}><td className="check-column"><button className={`task-checkbox ${task.done ? 'checked' : ''}`} disabled={busy} role="checkbox" aria-checked={task.done} aria-label={`${task.title}を${task.done ? '未完了' : '完了'}にする`} onClick={() => toggle(task)}>{task.done && <Check size={13} />}</button></td><td className="task-title-cell"><button onClick={() => { setEditing(task); setSaveError(''); setOpen(true); }}>{task.title}</button>{!task.done && task.due < today() && <span className="overdue-badge">期限超過</span>}</td><td><div className="assignee-cell"><Avatar id={task.assignee} small /><span>{members.find(m => m.id === task.assignee)?.name}</span></div></td><td><span className={`due-date ${!task.done && task.due < today() ? 'late' : ''} ${!task.done && task.due === today() ? 'today' : ''}`}><CalendarDays size={14} />{dateLabel(task.due)}{task.due === today() && !task.done && <small>今日</small>}</span></td><td><span className={`status-pill ${task.done ? 'done' : ''}`}><span />{task.done ? '完了' : '未完了'}</span></td><td><button className="row-more" aria-label={`${task.title}を編集`} onClick={() => { setEditing(task); setSaveError(''); setOpen(true); }}><MoreHorizontal size={18} /></button></td></tr>)}</tbody></table></div>
          {!ready && <div className="empty-state">タスクを読み込んでいます…</div>}
          {ready && !visible.length && <div className="empty-state"><span className="empty-icon"><CheckCheck size={28} /></span><strong>該当するタスクはありません</strong><p>絞り込み条件を変更するか、新しいタスクを登録しましょう。</p><Button variant="outline" onClick={startCreate} disabled={!activeMembers.length}><Plus size={16} />タスクを登録</Button></div>}
          <button ref={addButton} className="inline-add" onClick={startCreate} disabled={!activeMembers.length}><Plus size={16} />タスクを追加する</button>
          <div className="table-footer"><span>{visible.length ? `${(page - 1) * 50 + 1}–${Math.min(page * 50, visible.length)}` : '0'} / {visible.length}件を表示</span><div><button aria-label="前のページ" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={15} /></button><span>{page}</span><button aria-label="次のページ" disabled={page * 50 >= visible.length} onClick={() => setPage(p => p + 1)}><ChevronRight size={15} /></button></div></div>
        </section>
        <div className="bottom-note"><span><Leaf size={14} />ひとつずつ、着実に。今日もチームで進めていきましょう。</span><span>michiru — a little more, together.</span></div>
        <p className="demo-footnote">ログイン不要の共有ワークスペースです。他の人の変更は「一覧を再取得」で確認できます。</p>
      </main>
    </div>
    <Dialog.Root open={open} onOpenChange={value => { if (!busyRef.current) setOpen(value); }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content" onCloseAutoFocus={e => { e.preventDefault(); addButton.current?.focus(); }}><div className="dialog-header"><div className="dialog-symbol"><ListTodo size={21} /></div><Dialog.Close className="icon-button" aria-label="閉じる"><X size={20} /></Dialog.Close></div><Dialog.Title>{editing ? 'タスクの詳細・編集' : '新しいタスク'}</Dialog.Title><Dialog.Description>担当者と期限を決めて、次の一歩を明確に。</Dialog.Description><form key={editing?.id ?? 'new'} onSubmit={save}><fieldset disabled={busy}><label className="form-label" htmlFor="title">タスク名 <span>必須</span></label><input id="title" name="title" required maxLength={100} defaultValue={editing?.title ?? ''} placeholder="何をする必要がありますか？" onInput={e => e.currentTarget.setCustomValidity('')} /><label className="form-label" htmlFor="description">詳細説明 <small>任意</small></label><textarea id="description" name="description" maxLength={5000} defaultValue={editing?.description ?? ''} placeholder="補足情報や、完了の目安を記入しましょう" rows={4} /><div className="form-grid"><div><label className="form-label" htmlFor="assignee">担当者 <span>必須</span></label><select id="assignee" name="assignee" required defaultValue={editing?.assignee ?? ""}><option value="" disabled>担当者を選択</option>{members.filter(m => m.active || m.id === editing?.assignee).map(m => <option key={m.id} value={m.id}>{m.name}{!m.active ? "（無効）" : ""}</option>)}</select></div><div><label className="form-label" htmlFor="due">期限 <span>必須</span></label><input type="date" id="due" name="due" required defaultValue={editing?.due ?? today()} /></div></div>{editing && <label className="done-label"><input type="checkbox" name="done" defaultChecked={editing.done} />このタスクを完了にする</label>}{saveError && <p role="alert" className="form-error save-error">{saveError}</p>}<div className="dialog-footer"><Dialog.Close asChild><Button variant="outline" type="button">キャンセル</Button></Dialog.Close><Button type="submit"><Check size={16} />{busy ? '保存中…' : editing ? '変更を保存' : 'タスクを登録'}</Button></div></fieldset></form></Dialog.Content></Dialog.Portal></Dialog.Root>
    <Dialog.Root open={teamOpen} onOpenChange={setTeamOpen}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content compact-dialog"><Dialog.Title>チームメンバー</Dialog.Title><Dialog.Description>チームワークスペースの仲間たち</Dialog.Description><Dialog.Close className="dialog-x icon-button" aria-label="閉じる"><X size={20} /></Dialog.Close><div className="member-list">{members.map(m => <button key={m.id} onClick={() => { setAssignee(m.id); setView('all'); setStatus('all'); setTeamOpen(false); setMobileMenu(false); }}><Avatar id={m.id} /><div><strong>{m.name}</strong><small>{m.active ? "チームメンバー" : "新規割り当て停止中"}</small></div><span>{tasks.filter(t => t.assignee === m.id && !t.done).length}件の未完了</span><ChevronRight size={16} /></button>)}</div></Dialog.Content></Dialog.Portal></Dialog.Root>
    <Dialog.Root open={helpOpen} onOpenChange={setHelpOpen}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content compact-dialog"><Dialog.Title>michiruの使い方</Dialog.Title><Dialog.Description>チームのやることを、ひとつの場所に。</Dialog.Description><Dialog.Close className="dialog-x icon-button" aria-label="閉じる"><X size={20} /></Dialog.Close><ol className="help-steps"><li><strong>タスクを登録</strong><p>「新規タスク」から、タスク名・担当者・期限を入力します。</p></li><li><strong>内容を確認・編集</strong><p>一覧のタスク名を押すと、詳細の確認と編集ができます。</p></li><li><strong>できたら、チェック</strong><p>左端のチェックで完了に。「完了したタスク」から未完了にも戻せます。</p></li></ol><p className="help-demo">URLを知っている人は全タスクを閲覧・編集できます。担当者の登録・新規割り当ての停止は管理者が行います。</p></Dialog.Content></Dialog.Portal></Dialog.Root>
    <div className="toast-region" role="status" aria-live="polite">{notice && <div className="toast"><span><Check size={16} /></span>{notice}<button aria-label="通知を閉じる" onClick={() => setNotice('')}><X size={15} /></button></div>}</div>
  </div></MemberContext.Provider>;
}
