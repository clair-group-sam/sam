-- ECC-01 (09/11) · ECCAIRS 2 from S.A.M.: the authority's released taxonomy cached (attributes of the entities we fill, their value
-- lists), the correspondence between S.A.M. values and E2 value ids, every submission kept with its payload and E2's answer,
-- and the E2 identity / status mirrored on the report. Nothing is sent without the safety desk's explicit action.

create table if not exists eccairs_attributes (
  taxonomy_id int not null,                -- released taxonomy id (1 = ECCAIRS Aviation 5.1.0.0 general)
  entity_code int not null,                -- 24 Occurrence, 4 Aircraft, 1 Aerodrome, 14 Events, 22 / 53 narratives…
  attribute_code int not null,
  description text not null,
  explanation text,
  data_type text,
  value_list_id int,                       -- when the attribute takes a value from a list
  min_instance int, max_instance int,
  loaded_at timestamptz not null default now(),
  primary key (taxonomy_id, entity_code, attribute_code)
);
alter table eccairs_attributes enable row level security;
drop policy if exists eccairs_attributes_read on eccairs_attributes; create policy eccairs_attributes_read on eccairs_attributes for select using (true);

create table if not exists eccairs_values (
  taxonomy_id int not null,
  value_list_id int not null,
  value_id int not null,                   -- the "identifier" used in reports
  description text not null,
  detailed text,
  parent int, level int,
  active boolean not null default true,
  primary key (taxonomy_id, value_list_id, value_id)
);
create index if not exists eccairs_values_list on eccairs_values (taxonomy_id, value_list_id);
alter table eccairs_values enable row level security;
drop policy if exists eccairs_values_read on eccairs_values; create policy eccairs_values_read on eccairs_values for select using (true);

create table if not exists eccairs_taxonomies (
  entity entity_code primary key references entities(code),
  taxonomy_id int not null,
  name text, version text,
  env text,                                -- sandbox | UAT | production at load time
  loaded_at timestamptz not null default now(),
  attributes int not null default 0, "values" int not null default 0
);
alter table eccairs_taxonomies enable row level security;
drop policy if exists eccairs_taxonomies_read on eccairs_taxonomies; create policy eccairs_taxonomies_read on eccairs_taxonomies for select using (true);

-- S.A.M. value → E2 value id, per entity (the authorities' taxonomies may differ) and per field of our model
create table if not exists eccairs_value_maps (
  entity entity_code not null references entities(code),
  field text not null,                     -- occurrence_class | phase | report_type | event_type | aircraft_type | operator | state | operation_type | …
  our_value text not null,
  attribute_code int not null,
  value_id int,
  note text,
  updated_at timestamptz not null default now(),
  primary key (entity, field, our_value)
);
alter table eccairs_value_maps enable row level security;
drop policy if exists eccairs_value_maps_read on eccairs_value_maps; create policy eccairs_value_maps_read on eccairs_value_maps for select using (true);

create table if not exists eccairs_submissions (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  report_id text not null references reports(id) on delete cascade,
  env text,
  kind text not null check (kind in ('create','edit','status','sync')),
  requested_status text,                   -- DRAFT | SENT
  payload jsonb,
  response jsonb,
  ok boolean not null default false,
  e2_id text, e2_version text, e2_status text,
  error text,
  by_person uuid references people(id) on delete set null,
  at timestamptz not null default now()
);
create index if not exists eccairs_submissions_report on eccairs_submissions (report_id, at desc);
alter table eccairs_submissions enable row level security;
drop policy if exists eccairs_submissions_read on eccairs_submissions; create policy eccairs_submissions_read on eccairs_submissions for select using (true);

alter table reports add column if not exists e2_id text;                 -- OR-0000000000095897
alter table reports add column if not exists e2_status text;             -- DRAFT | SENT | OPEN | PROCESSED | CLOSED | ARCHIVED (mirror)
alter table reports add column if not exists e2_version text;
alter table reports add column if not exists e2_sent_at timestamptz;
alter table reports add column if not exists e2_synced_at timestamptz;
alter table reports add column if not exists e2_payload jsonb;           -- the last taxonomyCodes sent (what the authority holds)
create index if not exists reports_e2 on reports (entity, e2_id) where e2_id is not null;
