CREATE TABLE public.omni_session (
  username text PRIMARY KEY,
  token text NOT NULL DEFAULT '',
  exp timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.omni_session TO service_role;
ALTER TABLE public.omni_session ENABLE ROW LEVEL SECURITY;