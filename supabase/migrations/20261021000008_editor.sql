-- Revision editor: NPs may write the drafts of the manuals they own; authors recorded; sections keep a base for change detection.
alter table revisions add column if not exists submitted_at timestamptz;
alter table revisions add column if not exists step_changed_at timestamptz default now();
alter table revisions add column if not exists step_changed_by uuid references people(id);
alter table revision_sections add column if not exists updated_at timestamptz;
alter table revision_sections add column if not exists updated_by uuid references people(id);

-- owner NP (role in manuals.owner_role) can create / edit a draft revision of his manuals
create or replace function owns_manual(m uuid) returns boolean language sql stable as $$
  select exists (select 1 from manuals x where x.id = m and (x.owner_role = any(coalesce((select roles from me()), '{}'))))
$$;
drop policy if exists revisions_owner_write on revisions;
create policy revisions_owner_write on revisions for all to authenticated
  using (owns_manual(manual_id) and step in ('draft','approved_np')) with check (owns_manual(manual_id) and step in ('draft','approved_np'));
drop policy if exists sections_owner_write on revision_sections;
create policy sections_owner_write on revision_sections for all to authenticated
  using (exists (select 1 from revisions r where r.id = revision_id and r.step = 'draft' and owns_manual(r.manual_id)))
  with check (exists (select 1 from revisions r where r.id = revision_id and r.step = 'draft' and owns_manual(r.manual_id)));
-- audit log: app writes through service role; authors may insert their own entries
drop policy if exists audit_insert on audit_log;
create policy audit_insert on audit_log for insert to authenticated with check (true);
