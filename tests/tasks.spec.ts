import { test, expect, type Page } from '@playwright/test';
import type { Task } from '../lib/types';
const me = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const initial: Task = { id: '00000000-0000-4000-8000-000000000010', title: '新サービスの企画書を作成する', description: 'サービスの目的を整理する', assignee: me, due: '2026-11-20', done: false, created: 1, version: 1 };
async function mockWorkspace(page: Page) {
  let tasks = [{ ...initial }];
  const writes: Array<Record<string, unknown>> = [];
  await page.route('**/api/workspace', route => route.fulfill({ json: { userId: me, members: [{ id: me, name: '山下 美咲', active: true }, { id: other, name: '田中 健太', active: true }], tasks } }));
  await page.route('**/api/tasks', async route => { const data = route.request().postDataJSON(); writes.push(data); const row: Task = { ...data, id: data.id ?? crypto.randomUUID(), version: (data.version ?? 0) + 1, created: 2 }; tasks = data.id ? tasks.map(t => t.id === data.id ? row : t) : [...tasks, row]; await route.fulfill({ status: data.id ? 200 : 201, json: row }); });
  return { writes, replace: (task: Task) => { tasks = [task]; } };
}

test('API経由の登録・編集・完了・復帰と再取得（APIモック）', async ({ page }) => {
  const mock = await mockWorkspace(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: initial.title, exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新規タスク', exact: true }).click();
  await page.getByLabel('タスク名').fill('リリース前の確認');
  await page.getByLabel('詳細説明').fill('動作確認を実施する');
  await page.getByLabel('担当者', { exact: false }).last().selectOption(other);
  await page.getByLabel('期限', { exact: false }).fill('2026-12-01');
  await page.getByRole('button', { name: 'タスクを登録', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'リリース前の確認', exact: true }).click();
  await expect(page.getByLabel('詳細説明')).toHaveValue('動作確認を実施する');
  await page.getByLabel('タスク名').fill('リリース前の最終確認');
  await page.getByRole('button', { name: '変更を保存' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'リリース前の最終確認', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'リリース前の最終確認を完了にする' }).click();
  await expect(page.getByRole('button', { name: 'リリース前の最終確認', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '完了したタスク', exact: true }).click();
  await page.getByRole('checkbox', { name: 'リリース前の最終確認を未完了にする' }).click();
  await page.getByRole('button', { name: /すべてのタスク/ }).click();
  await page.getByRole('combobox', { name: '担当者で絞り込み' }).selectOption(other);
  await page.getByRole('textbox', { name: 'タスクを検索' }).fill('リリース前');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  expect(mock.writes.map(w => w.version)).toEqual([undefined, 1, 2, 3]);
  expect(await page.evaluate(() => localStorage.getItem('michiru-tasks-v1'))).toBeNull();
});

test('モバイルでメニュー・空状態・キャンセル（APIモック）', async ({ page }) => {
  await mockWorkspace(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'メニューを開く' }).click();
  await page.getByRole('button', { name: /自分のタスク/ }).click();
  await expect(page.getByRole('heading', { name: '自分のタスク.' })).toBeVisible();
  await page.getByRole('textbox', { name: 'タスクを検索' }).fill('該当しない検索');
  await expect(page.getByText('該当するタスクはありません')).toBeVisible();
  await page.getByRole('button', { name: '新規タスク', exact: true }).click();
  await page.getByLabel('タスク名').fill('キャンセルするタスク');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('保存失敗時に入力を維持し、保存中の再送信を防ぐ（APIモック）', async ({ page }) => {
  await mockWorkspace(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  await page.route('**/api/tasks', async route => { calls++; await gate; await route.fulfill({ status: 503, json: { error: 'データを保存できませんでした。' } }); });
  await page.goto('/');
  await page.getByRole('button', { name: '新規タスク', exact: true }).click();
  await page.getByLabel('タスク名').fill('失敗しても残す入力');
  await page.getByRole('button', { name: 'タスクを登録', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存中…' })).toBeDisabled();
  release();
  await expect(page.getByRole('alert')).toHaveText('データを保存できませんでした。');
  await expect(page.getByLabel('タスク名')).toHaveValue('失敗しても残す入力');
  expect(calls).toBe(1);
});

test('競合で入力を残し、開き直すと最新の版を利用（APIモック）', async ({ page }) => {
  const mock = await mockWorkspace(page);
  await page.goto('/');
  await page.getByRole('button', { name: initial.title, exact: true }).click();
  await page.getByLabel('タスク名').fill('自分の入力');
  mock.replace({ ...initial, title: '他のメンバーの変更', version: 2 });
  await page.route('**/api/tasks', route => route.fulfill({ status: 409, json: { error: '別のメンバーが更新しました。' } }));
  await page.getByRole('button', { name: '変更を保存' }).click();
  await expect(page.getByRole('alert')).toHaveText('別のメンバーが更新しました。');
  await expect(page.getByLabel('タスク名')).toHaveValue('自分の入力');
  await page.getByRole('button', { name: 'キャンセル' }).click();
  await page.getByRole('button', { name: '他のメンバーの変更', exact: true }).click();
  await expect(page.getByLabel('タスク名')).toHaveValue('他のメンバーの変更');
});

test('接続失敗を空データやローカル保存に置き換えない', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('michiru-tasks-v1', '[{"title":"古いローカルタスク"}]'));
  await page.route('**/api/workspace', route => route.fulfill({ status: 503, json: { error: 'Supabaseの接続設定が必要です。' } }));
  await page.goto('/');
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Supabaseの接続設定が必要です。');
  await expect(page.getByRole('button', { name: '新規タスク', exact: true })).toHaveCount(0);
  await expect(page.getByText('古いローカルタスク')).toHaveCount(0);
});

test('未認証時にログインへ移動し、認証後に一覧へ（APIモック）', async ({ page }) => {
  await mockWorkspace(page);
  let loggedIn = false;
  await page.route('**/api/workspace', route => loggedIn ? route.fallback() : route.fulfill({ status: 401, json: { error: 'ログインしてください。' } }));
  await page.route('**/api/auth/login', route => { loggedIn = true; return route.fulfill({ json: { ok: true } }); });
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('メールアドレス').fill('member@example.test');
  await page.getByLabel('パスワード', { exact: true }).fill('test-password-123');
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.getByRole('button', { name: initial.title, exact: true })).toBeVisible();
});

test('招待リンクはフォーム送信で確認し、パスワードを設定（APIモック）', async ({ page }) => {
  let verified = 0;
  await page.route('**/auth/confirm', route => { verified++; return route.fulfill({ json: { ok: true } }); });
  await page.route('**/api/auth/password', route => route.fulfill({ json: { ok: true } }));
  await page.goto('/password?token_hash=test-token&type=invite');
  await expect(page).toHaveURL(/\/password$/);
  expect(verified).toBe(0);
  await page.getByLabel('新しいパスワード').fill('new-password-1234');
  await page.getByLabel('パスワード（確認）').fill('new-password-1234');
  await page.getByRole('button', { name: 'パスワードを保存' }).click();
  await expect(page).toHaveURL(/\/login\?updated=1$/);
  expect(verified).toBe(1);
});

test('APIは別オリジンの書き込みを実際のハンドラーで拒否', async ({ request }) => {
  const res = await request.post('/api/tasks', { headers: { Origin: 'https://external.example.test' }, data: {} });
  expect(res.status()).toBe(403);
  expect((await res.json()).error).toContain('送信元');
});
