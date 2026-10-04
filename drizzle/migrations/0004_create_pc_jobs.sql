CREATE TABLE public.pc_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz
);
CREATE INDEX pc_jobs_pending_idx ON public.pc_jobs (created_at) WHERE status = 'pending';
GRANT ALL ON public.pc_jobs TO service_role;
ALTER TABLE public.pc_jobs ENABLE ROW LEVEL SECURITY;