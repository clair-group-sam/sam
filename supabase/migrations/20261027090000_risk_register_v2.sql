-- Risk register v2 (MSM AJD/ASJ §3.2.2, 3.4, 3.5, 3.7 · ASF §3.1–3.4): a RISK ASSESSMENT holds hazards, as in Centrik —
-- hazard log entries (HZ), management of change (MOC) and one-off risk assessments (RA). Participants identified, validation by the
-- most relevant nominated person (or deputy / SM), final acceptance of the residual risk by the Accountable Manager, review date.
create table if not exists risk_assessments (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  kind text not null check (kind in ('hazard_log','moc','ra')),
  number text not null,                        -- HZ OPS-3 · MOC 13 · RA 7 · MOC 2026-02
  name text not null,
  description text,
  domain text,                                 -- Flight Ops · Ground Ops · Crew Training · CAMO · Compliance & Safety · Information security · ATO · FSTD · Maintenance · Organisation
  status text not null default 'draft' check (status in ('draft','validated','accepted','archived','cancelled')),
  decision text check (decision in ('continue','continue_with_conditions','stop')),
  decision_comment text,
  top_risk boolean not null default false,
  version int not null default 1,
  conducted_on date,
  next_due date,
  participants jsonb not null default '[]',    -- [{"name":"…","role":"NPFO"}]
  owner_role text,
  validated_by uuid references people(id), validated_name text, validated_role text, validated_at timestamptz,
  accepted_by uuid references people(id), accepted_name text, accepted_at timestamptz,
  -- management of change (MSM AJD §3.4 steps 1–9 · ASF MOC form)
  moc_status text check (moc_status in ('assessment','approved','implemented','closed','cancelled')),
  category text,
  change_type text check (change_type in ('permanent','temporary')),
  start_date date, end_date date,
  reason text, requestor text,
  affected text,                               -- regulations, domains, services affected
  criticality text,                            -- criticality and impact incl. human performance
  prior_assessments text,                      -- prior safety assessments impacted
  actions_in_place text,                       -- actions / controls already in place and to create
  authority_route text,                        -- approval | notification | none
  project_id uuid references projects(id) on delete set null,
  project_task_id uuid references project_tasks(id) on delete set null,
  authority_file_id uuid references authority_files(id) on delete set null,
  -- origin
  source text not null default 'sam' check (source in ('sam','centrik','flightlogger','excel','word')),
  source_ref text,
  created_by uuid references people(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity, number)
);
create index if not exists risk_assessments_entity on risk_assessments (entity, kind, status);
create unique index if not exists risk_assessments_source on risk_assessments (source, source_ref) where source_ref is not null;

-- yesterday's MOCs become assessments of kind 'moc' (same id)
insert into risk_assessments (id, entity, kind, number, name, description, status, moc_status, category, owner_role, start_date, project_id, project_task_id, authority_file_id, decision_comment, accepted_by, accepted_at, created_by, created_at, updated_at)
select m.id, m.entity, 'moc', m.ref, m.title, m.description,
  case when m.status in ('approved','implemented','closed') then 'accepted' when m.status = 'cancelled' then 'cancelled' else 'draft' end,
  case when m.status = 'draft' then 'assessment' else m.status end,
  m.category, m.owner_role, m.target_date, m.project_id, m.project_task_id, m.authority_file_id, m.decision, m.approved_by, m.approved_at, m.created_by, m.created_at, m.updated_at
from mocs m on conflict do nothing;

alter table hazards add column if not exists assessment_id uuid references risk_assessments(id) on delete cascade;
alter table hazards add column if not exists main_impact text;
alter table hazards add column if not exists source_ref text;
alter table hazards add column if not exists needs_review boolean not null default false;  -- a new occurrence was linked: reassess (MSM §3.5.1)
update hazards set assessment_id = moc_id where moc_id is not null and assessment_id is null;
create index if not exists hazards_assessment on hazards (assessment_id);
create unique index if not exists hazards_source on hazards (assessment_id, source_ref) where source_ref is not null;

alter table risk_events add column if not exists assessment_id uuid references risk_assessments(id) on delete cascade;
update risk_events set assessment_id = moc_id where moc_id is not null and assessment_id is null;

-- safety reports linked to hazards (related cases)
create table if not exists hazard_reports (
  hazard_id uuid not null references hazards(id) on delete cascade,
  report_id text not null references reports(id) on delete cascade,
  linked_at timestamptz not null default now(),
  primary key (hazard_id, report_id)
);

-- one-time import tokens (Centrik / FlightLogger export scripts post here), 30 minutes, CMM only
create table if not exists import_tokens (
  token_hash text primary key,
  purpose text not null,
  created_by uuid references people(id),
  expires_at timestamptz not null,
  used_count int not null default 0,
  created_at timestamptz not null default now()
);
alter table risk_assessments enable row level security; alter table hazard_reports enable row level security; alter table import_tokens enable row level security;
