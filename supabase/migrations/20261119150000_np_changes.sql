-- NP-02 · NP management › Changes & approvals (19/11): a change of holder or deputy of a post is prepared here, linked to its
-- CAA application (Projects › CAA applications, type NP: Form 4 / Form 2, CV, organisation chart, competency assessment, MOC),
-- and applied to the post by Compliance on the day it takes effect. The post list (np_posts) only changes when a change is applied:
-- the history of who held what, since when and on which acceptance is this table.
create table if not exists np_changes (
  id uuid primary key default gen_random_uuid(),
  entity text not null,
  post_code text not null,
  post_title text,
  seat text not null default 'holder' check (seat in ('holder','deputy')),
  from_name text,                                   -- who holds the seat when the change is prepared (empty: vacant)
  to_name text,                                     -- who takes it (empty: the seat becomes vacant)
  to_person uuid references people(id) on delete set null,
  effective_on date,
  reason text,
  acceptance text not null default 'required' check (acceptance in ('required','not_required')),
  authority_file_id uuid references authority_files(id) on delete set null,
  status text not null default 'open' check (status in ('open','applied','cancelled')),
  applied_as text,                                  -- accepted | pending | not_required: what the post was set to
  applied_at timestamptz,
  applied_by uuid references people(id) on delete set null,
  cancel_note text,
  created_by uuid references people(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists np_changes_entity on np_changes (entity, status, effective_on);
alter table np_changes enable row level security;
drop policy if exists np_changes_read on np_changes;
create policy np_changes_read on np_changes for select to authenticated using (true);
