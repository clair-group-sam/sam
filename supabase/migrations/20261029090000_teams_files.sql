-- TMS-05 · files sent to S.A.M. in the personal Teams chat, kept until the person says which task they are the evidence of.
create table if not exists teams_files (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  name text not null,
  content_type text,
  size bigint,
  path text not null,                      -- storage key in bucket evidence: teams/<person>/<ts>-<name>
  note text,
  status text not null default 'pending',  -- pending | attached | discarded
  task_id uuid,
  target_kind text,                        -- action | authority
  target_id uuid,
  created_at timestamptz not null default now(),
  attached_at timestamptz
);
alter table teams_files enable row level security;
drop policy if exists teams_files_self on teams_files;
create policy teams_files_self on teams_files for select to authenticated using (person_id = (select id from me()) or has_role('CMM') or has_role('SUPERADMIN'));
