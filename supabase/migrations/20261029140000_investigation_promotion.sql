-- SAF-08 Internal safety investigation (ORO.GEN.200(a)(3), AMC1 ORO.GEN.200(a)(3); 376/2014 art. 13(1): analysis of occurrences; MSM §3 occurrence
-- reporting and investigation): an investigation is opened on a report by the safety desk — level, lead and team, terms of reference,
-- facts and timeline, analysis (contributing factors by category), causes, conclusions, safety recommendations (→ safety actions), final report.
create table if not exists investigations (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  number text not null,                                -- INV-<ENT>-<YYYY>-NN
  report_id text references reports(id) on delete set null,
  title text not null,
  level text not null default 'standard' check (level in ('light','standard','full')),
  status text not null default 'open' check (status in ('open','facts','analysis','report','closed','cancelled')),
  lead_person uuid references people(id), lead_name text,
  team jsonb not null default '[]',                    -- [{"name","role","person_id"}]
  terms text,                                          -- terms of reference: scope, questions to answer
  due date,
  timeline jsonb not null default '[]',                -- [{"at":"2026-10-14T19:01","text":"…"}]
  facts text,                                          -- what happened (facts gathered: interviews, data, documents)
  factors jsonb not null default '[]',                 -- [{"cat":"human|technical|organisational|environmental|procedural","text":"…"}]
  causes text,                                         -- root / main causes
  conclusions text,
  report_text text, report_model text,                 -- final investigation report (drafted by S.A.M. from the sections, edited by the lead)
  closed_at timestamptz, closed_by uuid references people(id),
  created_by uuid references people(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (entity, number)
);
create index if not exists investigations_entity on investigations (entity, status);
create index if not exists investigations_report on investigations (report_id);
create table if not exists investigation_events (
  id bigserial primary key,
  investigation_id uuid not null references investigations(id) on delete cascade,
  at timestamptz not null default now(), kind text not null, actor uuid references people(id), note text
);
create or replace function investigation_events_append_only() returns trigger language plpgsql as $$ begin raise exception 'investigation_events is append-only'; end $$;
drop trigger if exists investigation_events_ro on investigation_events;
create trigger investigation_events_ro before update or delete on investigation_events for each row execute function investigation_events_append_only();
alter table investigations enable row level security; alter table investigation_events enable row level security;
drop policy if exists investigations_read on investigations;
create policy investigations_read on investigations for select to authenticated using (entity = any(my_entities()));

alter table safety_actions add column if not exists investigation_id uuid references investigations(id) on delete set null;
alter table safety_actions drop constraint if exists safety_actions_source_kind_check;
alter table safety_actions add constraint safety_actions_source_kind_check check (source_kind in ('report','hazard','assessment','committee','audit','finding','spi','investigation','promotion','other'));

-- SAF-09 Safety promotion (ORO.GEN.200(a)(4) / AMC1 ORO.GEN.200(a)(4) safety communication; ICAO Doc 9859 §9.6; MSM §5):
-- safety bulletins (lessons learned, trends), safety notices (urgent, short, action required) and safety surveys (questionnaire, safety culture).
-- Published to an audience of the entity; reading / acknowledgement and answers are recorded per person.
create table if not exists safety_promotions (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  kind text not null check (kind in ('bulletin','notice','survey')),
  number text not null,                                -- SB-<ENT>-<YYYY>-NN · SN-… · SS-…
  title text not null,
  summary text,                                        -- one or two lines shown on the card / in the Inbox
  body text,                                           -- the bulletin / notice (plain text, paragraphs)
  audience text not null default 'all' check (audience in ('all','crew','office','np')),
  ack_required boolean not null default true,
  questions jsonb not null default '[]',               -- survey: [{"key","label","type":"scale|choice|text","options":[…]}]
  anonymous boolean not null default true,             -- survey answers stored without the person
  status text not null default 'draft' check (status in ('draft','published','closed')),
  published_at timestamptz, published_by uuid references people(id), due date, closes_at date,
  report_id text references reports(id) on delete set null,
  investigation_id uuid references investigations(id) on delete set null,
  hazard_id uuid,
  draft_model text,
  created_by uuid references people(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (entity, number)
);
create index if not exists safety_promotions_entity on safety_promotions (entity, status, kind);
create table if not exists safety_promotion_reads (
  promotion_id uuid not null references safety_promotions(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  sent_at timestamptz not null default now(), read_at timestamptz, acknowledged_at timestamptz, answered_at timestamptz,
  primary key (promotion_id, person_id)
);
create table if not exists safety_survey_answers (
  id bigserial primary key,
  promotion_id uuid not null references safety_promotions(id) on delete cascade,
  person_id uuid references people(id),                -- null when the survey is anonymous
  answers jsonb not null, at timestamptz not null default now()
);
alter table safety_promotions enable row level security; alter table safety_promotion_reads enable row level security; alter table safety_survey_answers enable row level security;
drop policy if exists safety_promotions_read on safety_promotions;
create policy safety_promotions_read on safety_promotions for select to authenticated using (entity = any(my_entities()) and status <> 'draft');
