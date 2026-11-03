-- AUD-01 · Compliance › Audit programme (03/11). One programme per entity and cycle (ENR-OPS-01 / ENR-M-01 / ENR-ATO-01, MSM §2.3.4 / §2.2.3):
-- the cycle (length, dates), the modules to audit (areas, with the requirements each one covers), the audits planned month by month.
-- Audits are the same object the Audits page will conduct (PRO-CM-02); a finding raised in an audit points to it.
-- Replanning keeps its reason (audit_events, append-only). Nothing is imported: the programme is built in S.A.M.

create table if not exists audit_programmes (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  title text not null,                                 -- Audit programme 2026-2027
  reference text,                                      -- ENR-OPS-01 · ENR-M-01 · ENR-ATO-01
  domains text[] not null default '{}',                -- OPS, CAMO, ATO, FSTD, CAE
  cycle_months int not null default 12 check (cycle_months between 6 and 36),
  starts_on date not null,
  ends_on date not null,
  requirements text[] not null default '{}',           -- what the cycle must cover (coverage matrix)
  status text not null default 'draft' check (status in ('draft','approved','closed')),
  approved_by uuid references people(id) on delete set null, approved_at timestamptz, approval_note text,
  previous_id uuid references audit_programmes(id) on delete set null,
  note text,
  created_by uuid references people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on > starts_on)
);
create index if not exists audit_programmes_entity on audit_programmes (entity, starts_on desc);
alter table audit_programmes enable row level security;
drop policy if exists audit_programmes_read on audit_programmes;
create policy audit_programmes_read on audit_programmes for select using (true);

create table if not exists audit_modules (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null references audit_programmes(id) on delete cascade,
  code text not null,                                  -- ATO-ORG, CAMO-3, SUB…
  title text not null,
  domain text,
  kind text not null default 'internal' check (kind in ('internal','subcontractor','checks','authority')),
  requirements text[] not null default '{}',
  sort int not null default 0,
  active boolean not null default true
);
create index if not exists audit_modules_programme on audit_modules (programme_id, sort);
alter table audit_modules enable row level security;
drop policy if exists audit_modules_read on audit_modules;
create policy audit_modules_read on audit_modules for select using (true);

create table if not exists audits (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  number text not null,                                -- AUD-ASJMT-2026-01
  programme_id uuid references audit_programmes(id) on delete set null,
  module_id uuid references audit_modules(id) on delete set null,
  kind text not null default 'internal' check (kind in ('internal','subcontractor','checks','authority')),
  domain text,
  title text not null,
  planned_month date not null,                         -- first day of the planned month
  planned_on date, planned_end date,                   -- exact dates once known
  lead_auditor uuid references people(id) on delete set null,
  auditors uuid[] not null default '{}',
  external_auditor text,                               -- external auditor / company (TTF…), authority inspector
  authority text,                                      -- authority audits: TM-CAD, DSAC, OSAC
  subcontractor text,
  scope text,
  status text not null default 'planned' check (status in ('planned','in_progress','report','closed','cancelled')),
  replanned int not null default 0,
  done_on date,
  note text,
  created_by uuid references people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity, number)
);
create index if not exists audits_programme on audits (programme_id, planned_month);
create index if not exists audits_entity on audits (entity, status);
alter table audits enable row level security;
drop policy if exists audits_read on audits;
create policy audits_read on audits for select using (true);

create table if not exists audit_events (
  id bigint generated always as identity primary key,
  audit_id uuid not null references audits(id) on delete cascade,
  at timestamptz not null default now(),
  by uuid references people(id) on delete set null,
  kind text not null check (kind in ('planned','replanned','cancelled','status','note')),
  from_month date, to_month date,
  status text,
  reason text
);
create index if not exists audit_events_audit on audit_events (audit_id, at);
alter table audit_events enable row level security;
drop policy if exists audit_events_read on audit_events;
create policy audit_events_read on audit_events for select using (true);
create or replace function audit_events_append_only() returns trigger language plpgsql as $$ begin raise exception 'audit_events is append-only'; end $$;
drop trigger if exists audit_events_no_change on audit_events;
create trigger audit_events_no_change before update or delete on audit_events for each row execute function audit_events_append_only();

-- a finding raised in an audit points to it
alter table findings add column if not exists audit_id uuid references audits(id) on delete set null;
create index if not exists findings_audit on findings (audit_id);
