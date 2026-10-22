-- Full revision cycle: who must read (audiences), authority return integrated before publication (DOC-03),
-- update notice at publication (DOC-04), notification / approval proposal kept for Compliance (DOC-06).

-- Who must read a manual. Tokens: 'ALL' (all staff of the manual's entity), 'ROLE:<post>' (holders and deputies), 'PERSON:<uuid>'.
-- No row = 'ALL'.
create table if not exists manual_audiences (
  manual_id uuid not null references manuals(id) on delete cascade,
  token text not null,
  primary key (manual_id, token)
);
alter table manual_audiences enable row level security;
drop policy if exists audiences_scope on manual_audiences;
create policy audiences_scope on manual_audiences for select to authenticated
  using (exists (select 1 from manuals m where m.id = manual_id and m.entity = any(my_entities())));

-- Authority return (DOC-03): what the authority sends back and how it was integrated.
alter table revisions add column if not exists return_kind text;            -- none | approval_page | approval_lep | consolidated
alter table revisions add column if not exists return_pdf_path text;        -- manuals/<ENT>/<CODE>/<rev>/authority-return.pdf
alter table revisions add column if not exists return_pages jsonb;          -- [{path, role: approval|lep|signature, page}]
alter table revisions add column if not exists return_received_at date;
alter table revisions add column if not exists return_by uuid references people(id);
-- DOC-06: proposal for the authority route, kept for Compliance (never shown in the document journal).
alter table revisions add column if not exists route_proposal jsonb;

-- Update notices sent at publication (DOC-04).
create table if not exists manual_notices (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references revisions(id) on delete cascade,
  manual_id uuid not null references manuals(id) on delete cascade,
  entity entity_code not null,
  sent_at timestamptz not null default now(),
  sent_by uuid references people(id),
  recipients int not null default 0,
  emailed int not null default 0,
  email_status text,
  subject text,
  body text
);
alter table manual_notices enable row level security;
drop policy if exists notices_scope on manual_notices;
create policy notices_scope on manual_notices for select to authenticated using (entity = any(my_entities()));

-- Tasks can point at the object they are about (e.g. the revision to read), so they close by themselves.
alter table tasks add column if not exists ref_id uuid;
create index if not exists tasks_owner_open on tasks (owner_person, status);
create index if not exists tasks_ref on tasks (ref_id);
