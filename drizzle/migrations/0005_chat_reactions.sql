CREATE TABLE public.chat_reactions (
 message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
 user_id uuid NOT NULL,
 emoji text NOT NULL CHECK (emoji IN ('👍','❤️','😂','😮','😢','😡')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (message_id, user_id, emoji)
);
GRANT SELECT, INSERT, DELETE ON public.chat_reactions TO authenticated;
GRANT ALL ON public.chat_reactions TO service_role;
ALTER TABLE public.chat_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read reactions on visible messages" ON public.chat_reactions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.chat_messages m WHERE m.id = message_id));
CREATE POLICY "add own reactions on visible messages" ON public.chat_reactions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.chat_messages m WHERE m.id = message_id));
CREATE POLICY "remove own reactions on visible messages" ON public.chat_reactions FOR DELETE TO authenticated USING (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.chat_messages m WHERE m.id = message_id));