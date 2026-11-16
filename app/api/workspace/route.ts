import { authenticated, ApiError, failure, response } from '@/lib/supabase/server';
import { toTask, type TaskRow } from '@/lib/types';
export async function GET() {
  try {
    const { db, user } = await authenticated();
    const { data: profiles, error: memberError } = await db.from('profiles').select('id,display_name,is_active').order('created_at');
    if (memberError) throw new ApiError(503, 'メンバー情報を取得できませんでした。');
    // PostgRESTの既定上限を越えても、ダッシュボード集計と絞り込みが欠けないようページ取得する。
    const tasks: TaskRow[] = [];
    for (let from = 0; ; from += 500) {
      const { data, error } = await db.from('tasks').select('id,title,description,assignee_id,due_date,status,created_at,version').order('due_date').order('created_at', { ascending: false }).order('id').range(from, from + 499);
      if (error) throw new ApiError(503, 'タスクを取得できませんでした。再試行してください。');
      tasks.push(...data as TaskRow[]);
      if (data.length < 500) break;
    }
    return response({ userId: user.id, members: profiles.map(m => ({ id: m.id, name: m.display_name, active: m.is_active })), tasks: tasks.map(toTask) });
  } catch (error) { return failure(error); }
}
