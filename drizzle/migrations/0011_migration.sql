CREATE TABLE IF NOT EXISTS public.pc_jobs_new (LIKE public.pc_jobs INCLUDING ALL);
GRANT ALL ON public.pc_jobs_new TO service_role;
GRANT ALL ON public.pc_jobs_new TO authenticated;
GRANT ALL ON public.pc_jobs_new TO anon;
ALTER TABLE public.pc_jobs_new ENABLE ROW LEVEL SECURITY;