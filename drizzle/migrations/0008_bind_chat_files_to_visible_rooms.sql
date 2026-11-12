DROP POLICY IF EXISTS "chat files read visible rooms" ON storage.objects;
CREATE POLICY "chat files read visible rooms"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'chat-files'
  AND (public.has_role((select auth.uid()), 'dispatcher'::public.app_role) OR public.has_role((select auth.uid()), 'admin'::public.app_role))
  AND EXISTS (
    SELECT 1 FROM public.chat_rooms r
    WHERE r.id::text = split_part(objects.name, '/', 1)
      AND (r.kind = 'group' OR r.dm_key IS NULL OR r.dm_key LIKE '%' || (select auth.uid())::text || '%')
  )
);

DROP POLICY IF EXISTS "chat files upload own" ON storage.objects;
CREATE POLICY "chat files upload own"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'chat-files'
  AND split_part(objects.name, '/', 2) = (select auth.uid())::text
  AND (public.has_role((select auth.uid()), 'dispatcher'::public.app_role) OR public.has_role((select auth.uid()), 'admin'::public.app_role))
  AND EXISTS (
    SELECT 1 FROM public.chat_rooms r
    WHERE r.id::text = split_part(objects.name, '/', 1)
      AND (r.kind = 'group' OR r.dm_key IS NULL OR r.dm_key LIKE '%' || (select auth.uid())::text || '%')
  )
);