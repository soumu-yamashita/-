export type Member = { id: string; name: string; active: boolean };
export type Task = { id: string; title: string; description: string; assignee: string; due: string; done: boolean; created: number; version: number };
export type Workspace = { tasks: Task[]; members: Member[] };
export type TaskRow = { id: string; title: string; description: string | null; assignee_id: string; due_date: string; status: 'todo' | 'done'; created_at: string; version: number };
export function toTask(row: TaskRow): Task { return { id: row.id, title: row.title, description: row.description ?? '', assignee: row.assignee_id, due: row.due_date, done: row.status === 'done', created: Date.parse(row.created_at), version: row.version }; }
