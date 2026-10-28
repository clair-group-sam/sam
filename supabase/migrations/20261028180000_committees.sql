-- SAF-05 Committees (step 4): Safety Review Board (MSM AJD / ASJ §4.5, AMC1 ORO.GEN.200(a)(1), CAMO.A.200(a)(1)) — strategic, chaired by
-- the AM, organised by the SM, with the nominated persons, at least twice a year (AJD / ASJ) · ASF: compliance and safety review committee
-- held within the CODIR at least once a quarter (MSM ASF §4.2) · Safety Action Group (§4.6) — implementation, NPs / supervisors / SMEs,
-- standing or ad hoc, reports to the SRB. Minutes: attendees, decisions, assigned actions; kept 5 years (MSM §1.6.5, owner AM).
create table if not exists committees (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  kind text not null check (kind in ('srb','sag')),
  number text not null,                        -- SRB 2026-S2 · SAG 2026-03 · CODIR 2026-Q4
  title text not null,
  topic text,                                  -- SAG: the topic (recurring findings, FDM trend, event, function…)
  status text not null default 'planned' check (status in ('planned','held','closed','cancelled')),  -- closed = minutes issued
  planned_on date,
  starts_at timestamptz, ends_at timestamptz,
  location text,
  attendees jsonb not null default '[]',      -- [{"name","role","person_id","present":true|false|null,"note"}]
  agenda jsonb not null default '[]',         -- [{"key","title","ref","notes","decision"}]
  pack jsonb, pack_at timestamptz,            -- figures presented (frozen when the pack is prepared)
  minutes text,                               -- summary of the minutes (drafted from the item notes, edited by the SM)
  minutes_model text,
  parent_id uuid references committees(id) on delete set null,  -- the SRB a SAG reports to
  closed_at timestamptz, closed_by uuid references people(id),
  source text not null default 'sam' check (source in ('sam','centrik','sharepoint')),
  source_ref text, source_url text,
  created_by uuid references people(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (entity, number)
);
create index if not exists committees_entity on committees (entity, kind, planned_on);
create unique index if not exists committees_source on committees (source, source_ref) where source_ref is not null;
create table if not exists committee_events (
  id bigserial primary key,
  committee_id uuid not null references committees(id) on delete cascade,
  at timestamptz not null default now(), kind text not null, actor uuid references people(id), note text
);
create or replace function committee_events_append_only() returns trigger language plpgsql as $$ begin raise exception 'committee_events is append-only'; end $$;
drop trigger if exists committee_events_ro on committee_events;
create trigger committee_events_ro before update or delete on committee_events for each row execute function committee_events_append_only();
alter table committees enable row level security; alter table committee_events enable row level security;
create policy committees_read on committees for select to authenticated using (entity = any(my_entities()));

-- actions decided by a committee
alter table safety_actions add column if not exists committee_id uuid references committees(id) on delete set null;

-- the SPIs on safety meetings are now counted by S.A.M. (entered history still wins)
update spi_defs set metric = 'meetings', updated_at = now() where code = 'SPI-10' and entity in ('AJD','ASJ') and metric is null;
update spi_defs set metric = 'meetings_srb', updated_at = now() where code = 'S10' and entity = 'ASF' and metric is null;
