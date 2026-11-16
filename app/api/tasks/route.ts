import { supabaseServer, ApiError, databaseError, failure, response, sameOrigin } from '@/lib/supabase/server';
import { taskInput, updateInput } from '@/lib/validation';
import { toTask, type TaskRow } from '@/lib/types';
async function write(request: Request, update: boolean) {
  try {
    sameOrigin(request);
    const db = supabaseServer();
    const json = await request.json().catch(() => { throw new ApiError(400, '入力形式が正しくありません。'); });
    const parsed = (update ? updateInput : taskInput).safeParse(json);
    if (!parsed.success) throw new ApiError(400, 'タスク名・担当者・期限などの入力内容を確認してください。');
    const p = parsed.data;
    if (!update && p.done) throw new ApiError(400, '新規タスクは未完了で登録してください。');
    const common = { p_title: p.title, p_description: p.description || null, p_assignee_id: p.assignee, p_due_date: p.due };
    const { data, error } = update
      ? await db.rpc('update_task', { ...common, p_id: json.id, p_expected_version: json.version, p_status: p.done ? 'done' : 'todo' }).single()
      : await db.rpc('create_task', common).single();
    if (error) throw databaseError(error);
    if (!data) throw new ApiError(503, '保存結果を確認できませんでした。一覧を再取得してください。');
    return response(toTask(data as TaskRow), update ? 200 : 201);
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) { return write(request, false); }
export async function PATCH(request: Request) { return write(request, true); }
