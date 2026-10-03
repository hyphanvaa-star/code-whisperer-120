CREATE TABLE public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dispatchers read settings" ON public.app_settings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'dispatcher') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "dispatchers insert settings" ON public.app_settings FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'dispatcher') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "dispatchers update settings" ON public.app_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'dispatcher') OR public.has_role(auth.uid(),'admin'));