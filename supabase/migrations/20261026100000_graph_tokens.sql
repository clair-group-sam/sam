-- Morning coffee phase 2: each person's Microsoft refresh token (delegated, read-only rights), encrypted by the app.
-- No policy: only the server (service role) reads or writes it.
create table if not exists graph_tokens (
  person_id uuid primary key references people(id) on delete cascade,
  refresh_enc text not null,
  updated_at timestamptz not null default now()
);
alter table graph_tokens enable row level security;
