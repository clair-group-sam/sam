-- Safety › Risk register (hazard log) and Management of change (MOC + its risk assessment). ICAO Doc 9859 5×5 matrix.
create table if not exists mocs (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  ref text not null unique,                    -- MOC-ASJ-2026-01
  title text not null,
  description text,                            -- what changes, why, when
  category text not null default 'procedure',  -- organisation | np | aircraft | procedure | equipment | base | subcontractor | other
  status text not null default 'draft' check (status in ('draft','assessment','approved','implemented','closed','cancelled')),
  owner_role text,
  owner_person uuid references people(id),
  target_date date,
  project_id uuid references projects(id) on delete set null,
  project_task_id uuid references project_tasks(id) on delete set null,
  authority_file_id uuid references authority_files(id) on delete set null,
  decision text,
  approved_by uuid references people(id),
  approved_at timestamptz,
  created_by uuid references people(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mocs_entity_status on mocs (entity, status);

create table if not exists hazards (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  ref text not null unique,                    -- HZ-ASJ-0007
  title text not null,
  description text,
  consequence text,                            -- worst credible consequence
  source text not null default 'other' check (source in ('report','moc','audit','finding','other')),
  report_id text references reports(id) on delete set null,
  moc_id uuid references mocs(id) on delete cascade,
  proposed boolean not null default false,     -- proposed by SAM, not yet kept by a person
  owner_role text,
  status text not null default 'open' check (status in ('open','monitoring','closed')),
  sev_before text check (sev_before in ('A','B','C','D','E')), lik_before int check (lik_before between 1 and 5),
  sev_after text check (sev_after in ('A','B','C','D','E')),  lik_after int check (lik_after between 1 and 5),
  review_date date,
  created_by uuid references people(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hazards_entity on hazards (entity, status);
create index if not exists hazards_moc on hazards (moc_id);

create table if not exists hazard_mitigations (
  id uuid primary key default gen_random_uuid(),
  hazard_id uuid not null references hazards(id) on delete cascade,
  text text not null,
  existing boolean not null default false,     -- already in place (true) or to put in place (false)
  owner_role text,
  due date,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists mitigations_hazard on hazard_mitigations (hazard_id);

create table if not exists risk_events (
  id bigserial primary key,
  hazard_id uuid references hazards(id) on delete cascade,
  moc_id uuid references mocs(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null,
  actor uuid references people(id),
  note text
);
revoke update, delete on risk_events from public, anon, authenticated;
alter table mocs enable row level security; alter table hazards enable row level security;
alter table hazard_mitigations enable row level security; alter table risk_events enable row level security;
