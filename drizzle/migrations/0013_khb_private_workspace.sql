CREATE TABLE public.khb_workspaces (
  user_id uuid PRIMARY KEY,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT khb_workspace_object CHECK (jsonb_typeof(state) = 'object'),
  CONSTRAINT khb_workspace_size CHECK (octet_length(state::text) <= 2000000)
);
GRANT SELECT, INSERT, UPDATE ON public.khb_workspaces TO authenticated;
GRANT ALL ON public.khb_workspaces TO service_role;
ALTER TABLE public.khb_workspaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY khb_workspace_owner_read ON public.khb_workspaces FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND (public.has_role(auth.uid(), 'dispatcher') OR public.has_role(auth.uid(), 'admin')));
CREATE POLICY khb_workspace_owner_insert ON public.khb_workspaces FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND (public.has_role(auth.uid(), 'dispatcher') OR public.has_role(auth.uid(), 'admin')));
CREATE POLICY khb_workspace_owner_update ON public.khb_workspaces FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND (public.has_role(auth.uid(), 'dispatcher') OR public.has_role(auth.uid(), 'admin')))
  WITH CHECK (user_id = auth.uid() AND (public.has_role(auth.uid(), 'dispatcher') OR public.has_role(auth.uid(), 'admin')));
CREATE FUNCTION public.save_khb_workspace(_state jsonb, _expected_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE saved public.khb_workspaces%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(), 'dispatcher') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Dispatcher access required' USING ERRCODE = '42501';
  END IF;
  IF _expected_revision IS NULL OR _expected_revision < 0 OR _state IS NULL OR jsonb_typeof(_state) <> 'object' THEN
    RAISE EXCEPTION 'Invalid workspace';
  END IF;
  IF _expected_revision = 0 THEN
    INSERT INTO public.khb_workspaces(user_id, state, revision) VALUES (auth.uid(), _state, 1)
    ON CONFLICT (user_id) DO NOTHING RETURNING * INTO saved;
  ELSE
    UPDATE public.khb_workspaces SET state = _state, revision = revision + 1, updated_at = now()
    WHERE user_id = auth.uid() AND revision = _expected_revision RETURNING * INTO saved;
  END IF;
  IF saved.user_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'revision', saved.revision, 'updated_at', saved.updated_at);
  END IF;
  SELECT * INTO saved FROM public.khb_workspaces WHERE user_id = auth.uid();
  RETURN jsonb_build_object('ok', false, 'conflict', true, 'revision', coalesce(saved.revision, 0), 'state', saved.state);
END;
$$;
REVOKE ALL ON FUNCTION public.save_khb_workspace(jsonb, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_khb_workspace(jsonb, bigint) TO authenticated, service_role;
COMMENT ON TABLE public.khb_workspaces IS 'Private account-owned Flight Planning drafts; independent of operational file retention.';