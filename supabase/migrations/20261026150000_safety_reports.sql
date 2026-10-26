-- SAF-01 Safety reports, lot 1: New report (factual precisions before sending), My reports, Reports + SM analysis.
-- Only the final report validated by the reporter is stored (no transcript). MOR clock: 72 h from RECEIPT in S.A.M. (376/2014 art. 4(8)).
alter table reports add column if not exists language text;            -- language the reporter wrote in
alter table reports add column if not exists narrative_en text;        -- English version for the SM (by SAM, when the reporter wrote in another language)
alter table reports add column if not exists headline_en text;
alter table reports add column if not exists location text;
alter table reports add column if not exists contributing text;        -- optional "contributing factors in your view", free text
alter table reports add column if not exists feedback text;            -- feedback to the reporter (376/2014 art. 13(4))
alter table reports add column if not exists mor_ref text;             -- ECCAIRS / authority reference once filed
alter table reports add column if not exists mor_filed_at timestamptz; -- stops the 72 h clock
alter table reports add column if not exists acknowledged_at timestamptz;
alter table reports add column if not exists classified_at timestamptz;
alter table reports add column if not exists closed_at timestamptz;
alter table report_analysis add column if not exists ran_at timestamptz;
alter table report_analysis add column if not exists model text;
alter table report_analysis add column if not exists summary text;
alter table report_analysis add column if not exists error text;

-- journal of the report (append-only): acknowledgement, classification, questions to the reporter and answers, MOR, feedback, closure
create table if not exists report_events (
  id bigserial primary key,
  report_id text not null references reports(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null,              -- received | acknowledged | analysis | erc | mor | question | answer | feedback | status | closed
  actor uuid references people(id),
  to_reporter boolean not null default false,  -- shown to the reporter in My reports (questions, feedback, status)
  note text,
  meta jsonb
);
create index if not exists report_events_report on report_events (report_id, at);
revoke update, delete on report_events from public, anon, authenticated;
alter table report_events enable row level security;
