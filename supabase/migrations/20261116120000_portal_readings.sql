-- PRJ-05 · Portal readings (16/11): what TMCAD / METEOR / Centrik showed on a given day, pasted as read (no credentials in S.A.M.,
-- the reading is done by a person signed in on the portal), then reconciled line by line with the CAA applications and the
-- authority findings. S.A.M. proposes, the desk ticks what to apply. The reading is kept: it is the proof of what the portal said.
create table if not exists portal_readings (
  id uuid primary key default gen_random_uuid(),
  read_on date not null,
  source text,                                   -- "TMCAD, Centrik AJD Compliance, METEOR ASTONJET, METEOR ASTONFLY"
  entities text[] not null default '{}',
  lines jsonb not null default '[]',             -- as read: one object per file or finding
  applied jsonb not null default '{}',           -- { "<line key>": { at, by, what } }
  created_by uuid references people(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table portal_readings enable row level security;
drop policy if exists portal_readings_read on portal_readings;
create policy portal_readings_read on portal_readings for select to authenticated using (true);
alter table authority_files add column if not exists imported_from text;      -- "portal reading 2026-11-16"
