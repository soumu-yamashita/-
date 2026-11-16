-- ユーザー指定の公開共有モード。ログインなしで全タスクを閲覧・登録・更新する。
-- 既存の行は保持する。適用後はanon key経由でも共有データにアクセスできる。
BEGIN;
ALTER TABLE public.profiles DROP CONSTRAINT profiles_id_fkey;
ALTER TABLE public.profiles ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.tasks ALTER COLUMN created_by DROP NOT NULL;
DROP POLICY profiles_read ON public.profiles;
DROP POLICY tasks_read ON public.tasks;
CREATE POLICY profiles_read ON public.profiles FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY tasks_read ON public.tasks FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON public.profiles, public.tasks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.profiles, public.tasks TO anon, authenticated;
CREATE OR REPLACE FUNCTION public.create_task(p_title text, p_description text, p_assignee_id uuid, p_due_date date)
RETURNS public.tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE result public.tasks;
BEGIN
  PERFORM id FROM public.profiles WHERE id = p_assignee_id FOR SHARE;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_assignee_id AND is_active) THEN
    RAISE EXCEPTION 'invalid_assignee' USING ERRCODE = '22023';
  END IF;
  IF p_title IS NULL OR p_due_date IS NULL THEN RAISE EXCEPTION 'required_fields' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.tasks(title, description, assignee_id, due_date, created_by)
  VALUES (private.trim_text(p_title), NULLIF(private.trim_text(p_description), ''), p_assignee_id, p_due_date, NULL)
  RETURNING * INTO result;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_task(p_id uuid, p_expected_version bigint, p_title text, p_description text, p_assignee_id uuid, p_due_date date, p_status text)
RETURNS public.tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE previous public.tasks; result public.tasks;
BEGIN
  PERFORM id FROM public.profiles WHERE id = p_assignee_id FOR SHARE;
  SELECT * INTO previous FROM public.tasks WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'task_missing' USING ERRCODE = 'PT404'; END IF;
  IF p_expected_version IS NULL OR previous.version <> p_expected_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE = 'PT409'; END IF;
  IF p_assignee_id IS NULL OR (p_assignee_id IS DISTINCT FROM previous.assignee_id AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_assignee_id AND is_active)) THEN
    RAISE EXCEPTION 'invalid_assignee' USING ERRCODE = '22023';
  END IF;
  IF p_title IS NULL OR p_due_date IS NULL OR p_status IS NULL OR p_status NOT IN ('todo', 'done') THEN
    RAISE EXCEPTION 'invalid_fields' USING ERRCODE = '22023';
  END IF;
  UPDATE public.tasks
  SET title = private.trim_text(p_title), description = NULLIF(private.trim_text(p_description), ''),
      assignee_id = p_assignee_id, due_date = p_due_date, status = p_status,
      completed_at = CASE WHEN p_status = 'todo' THEN NULL WHEN previous.status = 'done' THEN previous.completed_at ELSE clock_timestamp() END,
      updated_at = clock_timestamp(), version = version + 1
  WHERE id = p_id AND version = p_expected_version
  RETURNING * INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE = 'PT409'; END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.create_task(text, text, uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_task(uuid, bigint, text, text, uuid, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_task(text, text, uuid, date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_task(uuid, bigint, text, text, uuid, date, text) TO anon, authenticated;
DROP FUNCTION private.is_active_member();
COMMIT;
