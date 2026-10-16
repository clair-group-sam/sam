-- Compliance (FND-01/02) and Safety (SAF-01)
create table findings (
  id text primary key,                 -- FDGATO7, 2026-273…
  entity entity_code not null references entities(code),
  title text not null,
  requirement text,
  level text,
  owner_role text,
  phase text not null default 'notified',
  due date,
  notified date,
  audit_ref text
);
create table actions (
  id text primary key,                 -- ACT-000213
  entity entity_code not null references entities(code),
  finding_id text references findings(id),
  kind text not null default 'action', -- action | expected_manual_change
  title text not null,
  owner_role text,
  due date,
  done boolean not null default false,
  manual_id uuid references manuals(id),
  section_ref text,
  expected_change text,
  included_in_revision uuid references revisions(id),
  inclusion text check (inclusion in ('included','deferred','undecided')),
  verified_at date
);
create table change_requests (
  id text primary key,                 -- CR-0012
  entity entity_code not null references entities(code),
  manual_id uuid not null references manuals(id),
  section_ref text not null,
  requested_change text not null,
  reason text,
  from_person uuid references people(id),
  to_role text not null,
  status text not null default 'requested', -- requested | accepted | in_draft | published | declined
  revision_id uuid references revisions(id),
  created_at timestamptz not null default now()
);
-- Safety: only the final report is stored (SAF-01). Reporter identity in its own column, readable by SM / FSO.
create table reports (
  id text primary key,                 -- 209
  entity entity_code not null references entities(code),
  received_at timestamptz not null default now(),   -- MOR 72 h clock starts here (376/2014 art. 4(8))
  event_date date,
  event_time_utc time,
  aircraft text,
  flight_ref text,
  phase text,
  headline text not null,
  narrative text not null,
  complements jsonb not null default '{}',           -- the 3–5 factual precisions answered before sending
  anonymous boolean not null default false,
  reporter_person uuid references people(id),
  status text not null default 'received',          -- received | acknowledged | classified | investigation | closed
  feedback_sent_at timestamptz
);
create table report_analysis (
  report_id text primary key references reports(id) on delete cascade,
  adrep text[] not null default '{}',
  primary_hazard text,
  erc_outcome text, erc_barriers text, erc_value int,
  erc_override_by uuid references people(id),
  mor_status text check (mor_status in ('mandatory','likely','voluntary')),
  mor_basis text,
  mor_draft text,
  questions text[] not null default '{}',
  suggested_actions text[] not null default '{}',
  confirmed_at timestamptz,
  confirmed_by uuid references people(id)
);
alter table findings enable row level security; alter table actions enable row level security; alter table change_requests enable row level security;
alter table reports enable row level security; alter table report_analysis enable row level security;
create policy findings_scope on findings for select to authenticated using (entity = any(my_entities()));
create policy actions_scope on actions for select to authenticated using (entity = any(my_entities()));
create policy cr_scope on change_requests for all to authenticated using (entity = any(my_entities()));
-- a reporter sees their own reports; SM / FSO / CMM see the entity's reports
create policy reports_read on reports for select to authenticated using (reporter_person = (select id from me()) or (entity = any(my_entities()) and (has_role('SM') or has_role('FSO') or has_role('CMM'))));
create policy reports_insert on reports for insert to authenticated with check (entity = any(my_entities()));
create policy analysis_sm on report_analysis for all to authenticated using (has_role('SM') or has_role('CMM'));
-- reporter identity column: hidden from everyone but SM / FSO via a view
create view reports_safe as select r.*, case when has_role('SM') or has_role('FSO') then r.reporter_person else null end as reporter from reports r;
