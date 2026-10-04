create policy "Dispatchers read tool files" on storage.objects for select to authenticated
  using (bucket_id = 'tool-files' and (public.has_role(auth.uid(), 'dispatcher') or public.has_role(auth.uid(), 'admin')));
create policy "Dispatchers write tool files" on storage.objects for insert to authenticated
  with check (bucket_id = 'tool-files' and (public.has_role(auth.uid(), 'dispatcher') or public.has_role(auth.uid(), 'admin')));
create policy "Dispatchers update tool files" on storage.objects for update to authenticated
  using (bucket_id = 'tool-files' and (public.has_role(auth.uid(), 'dispatcher') or public.has_role(auth.uid(), 'admin')));
create policy "Dispatchers delete tool files" on storage.objects for delete to authenticated
  using (bucket_id = 'tool-files' and (public.has_role(auth.uid(), 'dispatcher') or public.has_role(auth.uid(), 'admin')));