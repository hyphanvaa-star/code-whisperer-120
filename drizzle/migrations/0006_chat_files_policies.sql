CREATE POLICY "chat files read visible rooms" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'chat-files' AND EXISTS (SELECT 1 FROM public.chat_rooms r WHERE r.id::text = split_part(name,'/',1)));
CREATE POLICY "chat files upload own" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'chat-files' AND split_part(name,'/',2) = auth.uid()::text
  AND EXISTS (SELECT 1 FROM public.chat_rooms r WHERE r.id::text = split_part(name,'/',1)));
CREATE POLICY "chat files admin delete" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'chat-files' AND public.has_role(auth.uid(),'admin'));