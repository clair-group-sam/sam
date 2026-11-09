-- 09/11/2026 · Roadmap step 4: Communication (outside the bot), Users & fleet, Settings (parameters), ERP, Part-IS.
-- Same rules as the other modules: read for every signed-in user (screens filter by entity), writes through server actions
-- that check the post (service role). Event logs are append-only.

-- ───────────────────────── Communication (COM, MSM §2.4 safety communication) ─────────────────────────
create table if not exists communications (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  title text not null,
  body text not null,
  kind text not null default 'information' check (kind in ('information','instruction','safety','urgent')),
  audience text[] not null default '{ALL}',          -- tokens: ALL · ROLE:<post> · PERSON:<uuid> (same as manual audiences)
  require_ack boolean not null default true,
  due date,                                          -- acknowledge before
  email boolean not null default true,               -- also by e-mail (Bcc) on top of Inbox + Teams card
  status text not null default 'draft' check (status in ('draft','sent','archived')),
  created_by uuid references people(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz, sent_by uuid references people(id) on delete set null,
  recipients int not null default 0, emailed int not null default 0, email_status text
);
create index if not exists communications_entity on communications (entity, created_at desc);
alter table communications enable row level security;
drop policy if exists communications_read on communications;
create policy communications_read on communications for select using (true);

create table if not exists communication_recipients (
  id bigserial primary key,
  communication_id uuid not null references communications(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  delivered_at timestamptz not null default now(),
  read_at timestamptz,
  acknowledged_at timestamptz,
  via text,                                           -- app | teams
  unique (communication_id, person_id)
);
alter table communication_recipients enable row level security;
drop policy if exists communication_recipients_read on communication_recipients;
create policy communication_recipients_read on communication_recipients for select using (true);

-- ───────────────────────── Users & fleet ─────────────────────────
create table if not exists aircraft (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  registration text not null unique,                 -- 9H-AST, F-HASJ
  type_code text,                                    -- C68A, C510, FA7X
  model text,                                        -- Citation Latitude
  msn text,
  base text,                                         -- LFPB
  camo text,                                         -- MT.CAMO.0079
  status text not null default 'in_service' check (status in ('in_service','stored','incoming','leaving','left')),
  note text,
  created_at timestamptz not null default now()
);
alter table aircraft enable row level security;
drop policy if exists aircraft_read on aircraft;
create policy aircraft_read on aircraft for select using (true);
insert into aircraft (entity, registration, type_code, model, base, camo) values
  ('ASJMT','9H-AST','C68A','Citation Latitude','LFPB','MT.CAMO.0079'),
  ('ASJMT','9H-SFJ','C68A','Citation Latitude','LFPB','MT.CAMO.0079'),
  ('ASJMT','9H-J4K','C68A','Citation Latitude','LFPB','MT.CAMO.0079'),
  ('ASJMT','9H-COB','C25M','Citation CJ4 Gen2','LFPB','MT.CAMO.0079'),
  ('ASJMT','9H-CBH','FA7X','Falcon 7X',null,'MT.CAMO.0079'),
  ('ASJMT','9H-MAX','GL7T','Global 7500',null,'MT.CAMO.0079'),
  ('ASJMT','9H-SOC','GLEX','Global Express',null,'MT.CAMO.0079'),
  ('ASJFR','F-GMTJ','C510','Citation Mustang','LFPB','MT.CAMO.0079'),
  ('ASJFR','F-HASJ','C510','Citation Mustang','LFPB','MT.CAMO.0079'),
  ('ASJFR','F-HERE','C510','Citation Mustang','LFPB','MT.CAMO.0079'),
  ('ASJFR','F-HGIO','C510','Citation Mustang','LFPB','MT.CAMO.0079'),
  ('ASJFR','F-HIBF','C510','Citation Mustang','LFPB','MT.CAMO.0079'),
  ('ASJFR','F-HILY','C510','Citation Mustang','LFPB','MT.CAMO.0079')
on conflict (registration) do nothing;

-- ───────────────────────── Settings › Parameters ─────────────────────────
create table if not exists app_params (
  key text primary key,
  value text not null,
  label text not null,
  hint text,
  updated_by uuid references people(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table app_params enable row level security;
drop policy if exists app_params_read on app_params;
create policy app_params_read on app_params for select using (true);
insert into app_params (key, value, label, hint) values
  ('reading_days','30','Days to acknowledge a manual revision','Due date of the reading task created at publication (DOC-04).'),
  ('comm_ack_days','14','Days to acknowledge a communication','Default due date of a new communication.'),
  ('cert_alerts','90,30,7','Certificate alerts (days before expiry)','Certificates & Validities (DOC-10).'),
  ('mor_hours','72','MOR clock (hours from receipt)','EU 376/2014 art. 4(8).'),
  ('ai_budget_eur','150','Monthly AI budget per entity (€)','AI-01: alert at 80 %.'),
  ('erp_review_months','12','ERP plan review (months)','Next review date proposed when a plan is reviewed.'),
  ('is_review_months','12','Part-IS risk review (months)','IS.I.OR.205 periodic review.')
on conflict (key) do nothing;

-- ───────────────────────── ERP (Emergency Response Plan) ─────────────────────────
create table if not exists erp_plans (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  code text, title text not null,
  scope text,                                        -- accident, serious incident, missing aircraft, security…
  manual_ref text,                                   -- ERP manual / OM-A chapter
  version text,
  reviewed_on date, next_review date,
  owner_role text default 'SM',
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table erp_plans enable row level security;
drop policy if exists erp_plans_read on erp_plans;
create policy erp_plans_read on erp_plans for select using (true);

create table if not exists erp_contacts (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  crisis_role text not null,                         -- Crisis director, Family assistance, BEA / AAIU, Insurer…
  name text, organisation text,
  phone text, email text,
  available text,                                    -- 24/7, office hours
  ord int not null default 100,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table erp_contacts enable row level security;
drop policy if exists erp_contacts_read on erp_contacts;
create policy erp_contacts_read on erp_contacts for select using (true);

create table if not exists erp_checklists (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  plan_id uuid references erp_plans(id) on delete set null,
  title text not null,
  phase text not null default 'first hour',          -- first hour · first day · recovery
  owner_role text,
  items text not null default '',                    -- one action per line
  ord int not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table erp_checklists enable row level security;
drop policy if exists erp_checklists_read on erp_checklists;
create policy erp_checklists_read on erp_checklists for select using (true);

create table if not exists erp_activations (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  plan_id uuid references erp_plans(id) on delete set null,
  exercise boolean not null default false,
  level text not null default 'alert' check (level in ('alert','activation')),
  title text not null,
  started_at timestamptz not null default now(),
  started_by uuid references people(id) on delete set null,
  status text not null default 'open' check (status in ('open','closed')),
  closed_at timestamptz, closed_by uuid references people(id) on delete set null,
  summary text
);
alter table erp_activations enable row level security;
drop policy if exists erp_activations_read on erp_activations;
create policy erp_activations_read on erp_activations for select using (true);

create table if not exists erp_events (
  id bigserial primary key,
  activation_id uuid not null references erp_activations(id) on delete cascade,
  at timestamptz not null default now(),
  person_id uuid references people(id) on delete set null,
  kind text not null default 'log' check (kind in ('log','decision','contact','check','status')),
  text text not null,
  ref text                                            -- checklist id:line for a ticked action
);
create index if not exists erp_events_act on erp_events (activation_id, at);
alter table erp_events enable row level security;
drop policy if exists erp_events_read on erp_events;
create policy erp_events_read on erp_events for select using (true);
create or replace function erp_events_append_only() returns trigger language plpgsql as $$ begin raise exception 'erp_events is append-only'; end $$;
drop trigger if exists erp_events_ro on erp_events;
create trigger erp_events_ro before update or delete on erp_events for each row execute function erp_events_append_only();

create table if not exists erp_exercises (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  plan_id uuid references erp_plans(id) on delete set null,
  held_on date,
  kind text not null default 'tabletop' check (kind in ('tabletop','drill','full_scale')),
  scenario text not null,
  participants text,
  lessons text,
  actions text,
  status text not null default 'planned' check (status in ('planned','done','cancelled')),
  created_at timestamptz not null default now()
);
alter table erp_exercises enable row level security;
drop policy if exists erp_exercises_read on erp_exercises;
create policy erp_exercises_read on erp_exercises for select using (true);

-- ───────────────────────── Part-IS (EU 2023/203, 2022/1645) ─────────────────────────
create table if not exists is_systems (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  name text not null,                                -- Leon, FlightLogger, Web Manuals, TrustFlight, S.A.M.
  kind text,                                         -- operations, maintenance, training, document, communication
  provider text,
  hosting text,                                      -- SaaS EU, SaaS US, on-premises
  data text,                                         -- what it holds (flight data, crew records…)
  owner_role text,
  criticality text not null default 'medium' check (criticality in ('low','medium','high')),
  safety_relevant boolean not null default true,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table is_systems enable row level security;
drop policy if exists is_systems_read on is_systems;
create policy is_systems_read on is_systems for select using (true);

create table if not exists is_flows (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  from_system text not null,                         -- name of a system or an external party
  to_system text not null,
  data text,
  means text,                                        -- API, e-mail, manual export, EFB sync
  contract_ref text,
  is_clause boolean,                                 -- Part-IS clause in the contract
  criticality text not null default 'medium' check (criticality in ('low','medium','high')),
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table is_flows enable row level security;
drop policy if exists is_flows_read on is_flows;
create policy is_flows_read on is_flows for select using (true);

create table if not exists is_risks (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  system text,                                       -- system or flow concerned
  threat text not null,
  safety_impact text,
  likelihood int check (likelihood between 1 and 5),
  severity int check (severity between 1 and 5),
  treatment text,
  owner_role text,
  due date,
  status text not null default 'open' check (status in ('open','treated','accepted','closed')),
  reviewed_on date,
  created_at timestamptz not null default now()
);
alter table is_risks enable row level security;
drop policy if exists is_risks_read on is_risks;
create policy is_risks_read on is_risks for select using (true);

create table if not exists is_incidents (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  occurred_on date not null default current_date,
  title text not null,
  system text,
  description text,
  safety_impact text,
  reported boolean not null default false,           -- reported to the authority (IS.I.OR.230)
  report_ref text,
  actions text,
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now()
);
alter table is_incidents enable row level security;
drop policy if exists is_incidents_read on is_incidents;
create policy is_incidents_read on is_incidents for select using (true);
