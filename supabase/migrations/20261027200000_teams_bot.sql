-- TMS-01 · Teams bot "S.A.M." (COM-01 / COM-02 / COM-03): one personal conversation per person, cards sent for tasks,
-- answers written back from the card buttons. The conversation reference is what lets S.A.M. write to someone proactively.
create table if not exists teams_conversations (
  person_id uuid primary key references people(id) on delete cascade,
  teams_user_id text,                      -- 29:1… id of the user for the bot
  aad_object_id uuid,
  conversation_id text not null,           -- personal chat with the bot (19:…@unq.gbl.spaces or a:…)
  service_url text not null,               -- https://smba.trafficmanager.net/emea/
  tenant_id text,
  installed_by text,                       -- 'graph' (installed by S.A.M.) | 'user' (opened the bot)
  installed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table teams_conversations enable row level security;
drop policy if exists teams_conv_self on teams_conversations;
create policy teams_conv_self on teams_conversations for select to authenticated using (person_id = (select id from me()) or has_role('CMM') or has_role('SUPERADMIN'));

-- the card sent for a task (conversation, activity id) so it can be updated in place when answered
alter table tasks add column if not exists teams jsonb;
alter table tasks add column if not exists answered_via text;        -- app | teams
alter table tasks add column if not exists answered_at timestamptz;
alter table tasks add column if not exists answer text;              -- the comment typed on the card

-- incoming Teams activity, for the communications register (append-only)
create table if not exists teams_inbound (
  id bigserial primary key,
  at timestamptz not null default now(),
  person_id uuid references people(id),
  aad_object_id uuid,
  kind text not null,                      -- message | action | install | file
  verb text,
  task_id uuid,
  text text,
  meta jsonb
);
alter table teams_inbound enable row level security;
drop policy if exists teams_inbound_registers on teams_inbound;
create policy teams_inbound_registers on teams_inbound for select to authenticated using (has_role('CMM') or has_role('SUPERADMIN'));
revoke update, delete on teams_inbound from public, anon, authenticated;
