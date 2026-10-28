-- Safety actions (corrective / preventive / improvement): the only object with an owner and a due date (architecture rule), shared later
-- with Compliance (module column). Raised from a safety report, a hazard / mitigation, a risk assessment / MOC or a committee.
-- Life: open → in progress → done (by the owner, with evidence) → verified & closed (by the safety desk) → effectiveness checked at a date.
create table if not exists actions (
  id uuid primary key default gen_random_uuid(),
  entity text not null,
  number text not null,                                   -- ACT-AJD-2026-001
  module text not null default 'safety' check (module in ('safety','compliance')),
  kind text not null default 'corrective' check (kind in ('corrective','preventive','improvement')),
  title text not null,
  description text,
  owner_role text,
  owner_person uuid references people(id) on delete set null,
  due date,
  status text not null default 'open' check (status in ('open','in_progress','done','verified','cancelled')),
  source_kind text not null default 'other' check (source_kind in ('report','hazard','assessment','committee','audit','finding','other')),
  report_id text,
  hazard_id uuid references hazards(id) on delete set null,
  mitigation_id uuid references hazard_mitigations(id) on delete set null,
  assessment_id uuid references risk_assessments(id) on delete set null,
  done_at timestamptz, done_by uuid references people(id) on delete set null, done_note text,
  verified_at timestamptz, verified_by uuid references people(id) on delete set null, verified_note text,
  effectiveness_due date,
  effectiveness text check (effectiveness in ('effective','not_effective')),
  effectiveness_note text, effectiveness_at timestamptz, effectiveness_by uuid references people(id) on delete set null,
  follow_up_id uuid references actions(id) on delete set null,   -- new action opened when not effective
  created_by uuid references people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity, number)
);
create index if not exists actions_scope on actions (entity, module, status);
create index if not exists actions_report on actions (report_id);
create index if not exists actions_hazard on actions (hazard_id);

create table if not exists action_evidence (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references actions(id) on delete cascade,
  name text not null,
  path text,                       -- evidence/<entity>/actions/<id>/<file> ; null = kept on the server, recorded by name
  size int,
  note text,
  added_by uuid references people(id) on delete set null,
  added_at timestamptz not null default now()
);
create table if not exists action_events (
  id bigserial primary key,
  action_id uuid not null references actions(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null,
  actor uuid references people(id) on delete set null,
  note text
);
-- journal append-only
create or replace function action_events_ro() returns trigger language plpgsql as $$ begin raise exception 'action_events is append-only'; end $$;
drop trigger if exists action_events_ro on action_events;
create trigger action_events_ro before update or delete on action_events for each row execute function action_events_ro();

alter table hazard_mitigations add column if not exists action_id uuid references actions(id) on delete set null;

alter table actions enable row level security; alter table action_evidence enable row level security; alter table action_events enable row level security;
