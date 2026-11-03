-- UX-02 Morning coffee lot 3 (03/11): per-person ranking preferences, learnt from the buttons of the recap.
--   important  : senders / domains / topics always at least "Today" (tier 2) — e.g. the AM, an authority, a NP
--   muted      : senders / domains / topics always "Can wait" (tier 4) — set by "Not important"
--   snoozed    : [{ "key": "...", "until": "YYYY-MM-DD" }] — "Tomorrow" hides a line until that day
create table if not exists coffee_prefs (
  person_id uuid primary key references people(id) on delete cascade,
  important text[] not null default '{}',
  muted text[] not null default '{}',
  snoozed jsonb not null default '[]',
  updated_at timestamptz not null default now()
);
alter table coffee_prefs enable row level security;
