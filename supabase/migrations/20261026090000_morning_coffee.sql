-- UX-02 Morning coffee: one recap per person and day, prepared on demand (never sent), replaced by "brew again",
-- older days deleted when a new one is brewed.
create table if not exists coffee_recaps (
  person_id uuid not null references people(id) on delete cascade,
  day date not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (person_id, day)
);
alter table coffee_recaps enable row level security;
drop policy if exists coffee_own on coffee_recaps;
create policy coffee_own on coffee_recaps for select to authenticated using (person_id = (select id from me()));
