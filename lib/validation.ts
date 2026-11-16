import { z } from 'zod';
const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => { const date = new Date(`${s}T00:00:00Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === s; });
export const taskInput = z.object({ title: z.string().trim().min(1).max(100), description: z.string().trim().max(5000), assignee: uuid, due: day, done: z.boolean() }).strict();
export const updateInput = taskInput.extend({ id: uuid, version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) });
export const loginInput = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(256) }).strict();
export const emailInput = z.object({ email: z.string().email().max(254) }).strict();
export const passwordInput = z.object({ password: z.string().min(12).max(256) }).strict();
