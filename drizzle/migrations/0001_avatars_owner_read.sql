CREATE POLICY "Read own account avatar" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'account-avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
-- Writes are intentionally service-role-only, authorized by saveMyAvatar.
