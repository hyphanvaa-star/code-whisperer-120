CREATE TABLE public.handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift text NOT NULL CHECK (shift IN ('MORNING SHIFT','NIGHT SHIFT')),
  shift_date date NOT NULL,
  from_dsp text NOT NULL DEFAULT '',
  to_dsp text NOT NULL DEFAULT '',
  flights jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by uuid NOT NULL DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shift, shift_date, from_dsp)
);
GRANT SELECT, INSERT, UPDATE ON public.handovers TO authenticated;
GRANT ALL ON public.handovers TO service_role;
ALTER TABLE public.handovers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dispatchers read handovers" ON public.handovers FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'dispatcher'));
CREATE POLICY "dispatchers insert handovers" ON public.handovers FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'dispatcher') AND updated_by = auth.uid());
CREATE POLICY "dispatchers update handovers" ON public.handovers FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'dispatcher')) WITH CHECK (public.has_role(auth.uid(),'dispatcher') AND updated_by = auth.uid());