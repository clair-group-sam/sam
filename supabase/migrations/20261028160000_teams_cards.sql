-- TMS-02 · every card delivered to Teams (one row per task × person), so a task answered anywhere updates every copy;
-- tasks.teams_notified_at = the sweep has handled the task (whatever the outcome), the morning digest is sent once a day.
create table if not exists teams_cards (
  id bigserial primary key,
  task_id uuid not null references tasks(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  conversation_id text not null,
  service_url text not null,
  activity_id text not null,
  card_kind text not null default 'task',   -- task | batch (one card listing several new tasks)
  sent_at timestamptz not null default now(),
  updated_at timestamptz,                  -- the card was refreshed with the final state of the task
  unique (task_id, person_id)
);
create index if not exists teams_cards_open on teams_cards (task_id) where updated_at is null;
alter table teams_cards enable row level security;
drop policy if exists teams_cards_registers on teams_cards;
create policy teams_cards_registers on teams_cards for select to authenticated using (person_id = (select id from me()) or has_role('CMM') or has_role('SUPERADMIN'));

alter table tasks add column if not exists teams_notified_at timestamptz;
create index if not exists tasks_teams_pending on tasks (created_at) where status = 'open' and teams_notified_at is null;

alter table teams_conversations add column if not exists digest_sent_on date;
