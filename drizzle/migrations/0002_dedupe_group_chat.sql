WITH keep AS (SELECT id FROM public.chat_rooms WHERE kind='group' ORDER BY created_at, id LIMIT 1)
UPDATE public.chat_messages m SET room_id=(SELECT id FROM keep)
WHERE m.room_id IN (SELECT id FROM public.chat_rooms WHERE kind='group') AND m.room_id <> (SELECT id FROM keep);
DELETE FROM public.chat_rooms WHERE kind='group' AND id <> (SELECT id FROM public.chat_rooms WHERE kind='group' ORDER BY created_at, id LIMIT 1);
CREATE UNIQUE INDEX IF NOT EXISTS chat_rooms_one_group ON public.chat_rooms ((kind)) WHERE kind='group';