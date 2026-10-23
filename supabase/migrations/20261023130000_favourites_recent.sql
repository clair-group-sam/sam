-- Library shortcuts across entities: favourite manuals (★) and recently opened manuals, per person.
create table if not exists manual_favourites (
  person_id uuid not null references people(id) on delete cascade,
  manual_id uuid not null references manuals(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (person_id, manual_id)
);
create table if not exists manual_views (
  person_id uuid not null references people(id) on delete cascade,
  manual_id uuid not null references manuals(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (person_id, manual_id)
);
alter table manual_favourites enable row level security;
alter table manual_views enable row level security;
drop policy if exists favourites_own on manual_favourites;
create policy favourites_own on manual_favourites for select to authenticated using (person_id = (select id from me()));
drop policy if exists views_own on manual_views;
create policy views_own on manual_views for select to authenticated using (person_id = (select id from me()));
