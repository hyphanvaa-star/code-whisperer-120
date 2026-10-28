CREATE OR REPLACE FUNCTION public.tool_file_owners()
RETURNS TABLE(name text, owner_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, storage
AS $$ SELECT o.name, o.owner_id FROM storage.objects o WHERE o.bucket_id = 'tool-files' AND split_part(o.name,'/',1) IN ('excel','atc','merged','briefing','regnotice','notices-tmp') $$;
REVOKE ALL ON FUNCTION public.tool_file_owners() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tool_file_owners() TO service_role;