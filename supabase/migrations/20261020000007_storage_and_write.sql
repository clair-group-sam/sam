-- Storage buckets (private) and write policies for the document module (CMM / SUPERADMIN).
insert into storage.buckets (id, name, public, file_size_limit)
values ('manuals','manuals',false, 52428800), ('certificates','certificates',false, 52428800), ('evidence','evidence',false, 52428800)
on conflict (id) do nothing;

-- Uploads from the browser by the CMM (import bridge); reads go through the app (signed URLs), never directly.
drop policy if exists manuals_bucket_cmm_write on storage.objects;
create policy manuals_bucket_cmm_write on storage.objects for all to authenticated
  using (bucket_id in ('manuals','certificates','evidence') and (has_role('CMM') or has_role('SUPERADMIN')))
  with check (bucket_id in ('manuals','certificates','evidence') and (has_role('CMM') or has_role('SUPERADMIN')));

-- Document tables: CMM / SUPERADMIN may write (authors and NPs come with the editor and finer policies).
create policy manuals_cmm_write on manuals for all to authenticated using (has_role('CMM') or has_role('SUPERADMIN')) with check (has_role('CMM') or has_role('SUPERADMIN'));
create policy revisions_cmm_write on revisions for all to authenticated using (has_role('CMM') or has_role('SUPERADMIN')) with check (has_role('CMM') or has_role('SUPERADMIN'));
create policy sections_cmm_write on revision_sections for all to authenticated using (has_role('CMM') or has_role('SUPERADMIN')) with check (has_role('CMM') or has_role('SUPERADMIN'));
create policy certificates_cmm_write on certificates for all to authenticated using (has_role('CMM') or has_role('SUPERADMIN')) with check (has_role('CMM') or has_role('SUPERADMIN'));

-- Trace of imports (Registers › audit) and source metadata on revisions.
alter table revisions add column if not exists source jsonb;   -- {system:'webmanuals', manualId, revisionId, pdfURL, importedAt}
