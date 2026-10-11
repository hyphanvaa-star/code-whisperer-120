CREATE TABLE public.chat_rooms (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'group',
  name text not null default '',
  dm_key text unique,
  created_by uuid,
  created_at timestamptz not null default now()
);
GRANT SELECT, INSERT ON public.chat_rooms TO authenticated;
GRANT ALL ON public.chat_rooms TO service_role;
ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dispatchers read rooms" ON public.chat_rooms FOR SELECT TO authenticated
  USING ((has_role(auth.uid(), 'dispatcher'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
    AND (kind = 'group' OR dm_key IS NULL OR dm_key LIKE '%' || auth.uid()::text || '%'));
CREATE POLICY "dispatchers create rooms" ON public.chat_rooms FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'dispatcher'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  user_id uuid not null,
  body text not null,
  created_at timestamptz not null default now()
);
CREATE INDEX chat_messages_room_created ON public.chat_messages (room_id, created_at);
GRANT SELECT, INSERT, DELETE ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dispatchers read messages" ON public.chat_messages FOR SELECT TO authenticated
  USING ((has_role(auth.uid(), 'dispatcher'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
    AND EXISTS (SELECT 1 FROM public.chat_rooms r WHERE r.id = room_id
      AND (r.kind = 'group' OR r.dm_key IS NULL OR r.dm_key LIKE '%' || auth.uid()::text || '%')));
CREATE POLICY "dispatchers send messages" ON public.chat_messages FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid()
    AND (has_role(auth.uid(), 'dispatcher'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
    AND EXISTS (SELECT 1 FROM public.chat_rooms r WHERE r.id = room_id
      AND (r.kind = 'group' OR r.dm_key IS NULL OR r.dm_key LIKE '%' || auth.uid()::text || '%')));
CREATE POLICY "admin delete messages" ON public.chat_messages FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "dispatchers read profiles" ON public.profiles FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'dispatcher'::app_role) OR has_role(auth.uid(), 'admin'::app_role));