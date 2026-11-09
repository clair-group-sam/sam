-- KPI-01 (09/11) · Compliance indicators of ENR-CM-06 computed from S.A.M. (C1…C11), monthly snapshots kept for the SRB / CODIR
-- dashboard; annual review of the audit programme (DSAC #1416100: the programme is reviewed every year, traced, presented to the CODIR).

create table if not exists kpi_targets (
  entity entity_code not null references entities(code),
  code text not null,                               -- C1…C11 (ENR-CM-06)
  target numeric not null,
  alert numeric,                                    -- alert threshold between target and "off target"
  owner_role text,
  origin text,                                      -- finding / audit that motivated it
  active boolean not null default true,
  primary key (entity, code)
);
alter table kpi_targets enable row level security;
drop policy if exists kpi_targets_read on kpi_targets; create policy kpi_targets_read on kpi_targets for select using (true);

create table if not exists kpi_snapshots (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  code text not null,
  month date not null,                              -- first day of the month the value stands for
  value numeric,
  numerator numeric, denominator numeric,
  status text,                                      -- on_target | alert | off_target | n_a
  note text,
  computed_at timestamptz not null default now(),
  unique (entity, code, month)
);
alter table kpi_snapshots enable row level security;
drop policy if exists kpi_snapshots_read on kpi_snapshots; create policy kpi_snapshots_read on kpi_snapshots for select using (true);

-- ENR-CM-06 Ed.1 Rev.2 (21/09/2026) · compliance targets, Astonfly first; the other entities start from the same values
insert into kpi_targets (entity, code, target, alert, owner_role, origin)
select e.code, k.code, k.target, k.alert, 'CMM', case when e.code = 'ASFFR' then k.origin else null end
from entities e cross join (values
  ('C1', 100, 80, 'DSAC #1047900 – audit plan not up to date'),
  ('C2', 90, 70, null),
  ('C3', 8, 12, 'Audit ATO 2025: 8 E2'),
  ('C4', 0, 2, 'FDGSC2601 / FDGSC2602'),
  ('C5', 0, 1, '#1191580'),
  ('C6', 90, 120, 'Reference 2025-2026: 108 d internal, 70 d authority'),
  ('C7', 80, 60, 'FDGATO7: cause and plan refused'),
  ('C8', 100, 80, 'FDGATO1 / FDGFSTD1'),
  ('C9', 100, 80, 'DSAC #1191580'),
  ('C10', 0, 1, 'OM D.02, D.03, Safety Manual; A.05'),
  ('C11', 100, 75, 'FDGATO7')) as k(code, target, alert, origin)
on conflict do nothing;

-- annual review of the programme
alter table audit_programmes add column if not exists reviewed_on date;
alter table audit_programmes add column if not exists review_note text;
alter table audit_programmes add column if not exists next_review_on date;
update audit_programmes set next_review_on = (coalesce(approved_at::date, starts_on) + interval '12 months')::date where next_review_on is null and status = 'approved';

insert into notification_rules (kind, label, remind_days, chase_days, escalate_days, escalate_to, am_days) values
  ('programme_review', 'Annual review of the audit programme', 30, 7, 14, 'CMM', 30),
  ('kpi_month', 'Monthly indicators to present', 0, 5, null, null, null)
on conflict do nothing;
