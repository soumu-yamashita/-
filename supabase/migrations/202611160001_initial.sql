-- Supabaseのauthスキーマ・anon/authenticatedロールがある環境に適用する。
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE FUNCTION private.trim_text(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path = ''
AS $$ SELECT pg_catalog.btrim(value, E' \t\n\r\f' || U&'\000B\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'); $$;
REVOKE ALL ON FUNCTION private.trim_text(text) FROM PUBLIC, anon, authenticated;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100 AND display_name = private.trim_text(display_name)),
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100 AND title = private.trim_text(title)),
  description text CHECK (char_length(description) <= 5000 AND description <> ''),
  assignee_id uuid NOT NULL CONSTRAINT tasks_assignee_id_fkey REFERENCES public.profiles(id) ON DELETE RESTRICT,
  due_date date NOT NULL CHECK (isfinite(due_date)),
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'done')),
  completed_at timestamptz,
  created_by uuid NOT NULL CONSTRAINT tasks_created_by_fkey REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1 AND version <= 9007199254740991),
  CONSTRAINT tasks_completion_check CHECK ((status = 'todo' AND completed_at IS NULL) OR (status = 'done' AND completed_at IS NOT NULL))
);
CREATE INDEX tasks_status_due_idx ON public.tasks(status, due_date ASC, created_at DESC, id ASC);
CREATE INDEX tasks_assignee_status_due_idx ON public.tasks(assignee_id, status, due_date ASC, created_at DESC, id ASC);
CREATE INDEX tasks_created_by_idx ON public.tasks(created_by);

CREATE FUNCTION private.is_active_member() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND is_active); $$;
REVOKE ALL ON FUNCTION private.is_active_member() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_active_member() TO authenticated;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profiles, public.tasks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.profiles, public.tasks TO authenticated;
CREATE POLICY profiles_read ON public.profiles FOR SELECT TO authenticated USING ((SELECT private.is_active_member()));
CREATE POLICY tasks_read ON public.tasks FOR SELECT TO authenticated USING ((SELECT private.is_active_member()));

CREATE FUNCTION public.create_task(p_title text, p_description text, p_assignee_id uuid, p_due_date date)
RETURNS public.tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE result public.tasks;
BEGIN
  -- 無効化との競合を避ける。ロック順はユーザーIDで統一。
  PERFORM id FROM public.profiles WHERE id IN (auth.uid(), p_assignee_id) ORDER BY id FOR SHARE;
  IF NOT private.is_active_member() THEN RAISE EXCEPTION 'not_active' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_assignee_id AND is_active) THEN
    RAISE EXCEPTION 'invalid_assignee' USING ERRCODE = '22023';
  END IF;
  IF p_title IS NULL OR p_due_date IS NULL THEN RAISE EXCEPTION 'required_fields' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.tasks(title, description, assignee_id, due_date, created_by)
  VALUES (private.trim_text(p_title), NULLIF(private.trim_text(p_description), ''), p_assignee_id, p_due_date, auth.uid())
  RETURNING * INTO result;
  RETURN result;
END;
$$;

CREATE FUNCTION public.update_task(p_id uuid, p_expected_version bigint, p_title text, p_description text, p_assignee_id uuid, p_due_date date, p_status text)
RETURNS public.tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE previous public.tasks; result public.tasks;
BEGIN
  PERFORM id FROM public.profiles WHERE id IN (auth.uid(), p_assignee_id) ORDER BY id FOR SHARE;
  IF NOT private.is_active_member() THEN RAISE EXCEPTION 'not_active' USING ERRCODE = '42501'; END IF;
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
GRANT EXECUTE ON FUNCTION public.create_task(text, text, uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_task(uuid, bigint, text, text, uuid, date, text) TO authenticated;
COMMIT;
