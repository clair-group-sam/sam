-- FND-03 · Compliance › Findings (roadmap item 2, 30/10). Replaces the prototype tables findings / actions (text ids, never used by the app).
-- One finding = what the auditor / inspector found + the NP's analysis (root cause, contributing factors, immediate action) + a corrective
-- action plan made of expected manual changes (FND-01/02, finding_changes) and other actions (safety_actions, module 'compliance').
-- Each NP answer is a round: S.A.M. pre-reads it (suggestions only, for Compliance), Compliance accepts or sends it back with the points to address.
drop table if exists actions;
drop table if exists findings cascade;

create table findings (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  number text not null,                                -- FND-ASJMT-2026-001
  source text not null default 'authority' check (source in ('authority','internal_audit','inspection','subcontractor','other')),
  authority text,                                      -- TM-CAD, OSAC, DSAC… (source authority)
  audit_ref text,                                      -- audit / inspection reference, finding reference at the authority
  level text not null default '2' check (level in ('1','2','3','obs')),
  requirement text,                                    -- ORO.GEN.200(a)(3), CAMO.A.305…
  title text not null,
  description text,                                    -- the finding as written by the auditor
  owner_role text,
  owner_person uuid references people(id) on delete set null,
  notified date,                                       -- date the finding was raised
  due date,                                            -- date the answer (RCA + CAP) is due at the authority
  status text not null default 'open' check (status in ('open','answered','sent_back','accepted','closure_requested','closed','cancelled')),
  current_round int not null default 0,
  authority_file_id uuid references authority_files(id) on delete set null,   -- OM-FND dossier
  closed_at timestamptz, closed_by uuid references people(id) on delete set null, closed_note text,
  created_by uuid references people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity, number)
);
create index findings_scope on findings (entity, status);
alter table findings enable row level security;
drop policy if exists findings_read on findings;
create policy findings_read on findings for select using (true);

-- one row per NP answer; S.A.M.'s pre-read and Compliance's decision live on the same row
create table finding_rounds (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references findings(id) on delete cascade,
  n int not null,
  root_cause text,
  factors text,                                        -- contributing / organisational factors
  immediate text,                                      -- immediate / containment action
  answered_by uuid references people(id) on delete set null,
  answered_at timestamptz not null default now(),
  via text not null default 'app',                     -- app | teams
  assistant jsonb,                                     -- {"verdict":"complete|incomplete|off_topic","points":[{"code","label","detail"}],"model":"…","at":"…"}
  decision text check (decision in ('accepted','sent_back')),
  points jsonb,                                        -- the points Compliance actually sent back [{"code","label","detail"}]
  decided_by uuid references people(id) on delete set null,
  decided_at timestamptz,
  note text,
  unique (finding_id, n)
);
alter table finding_rounds enable row level security;
drop policy if exists finding_rounds_read on finding_rounds;
create policy finding_rounds_read on finding_rounds for select using (true);

-- expected manual changes (FND-01): followed through the revision that includes them, verified by Compliance after publication (FND-02)
create table finding_changes (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references findings(id) on delete cascade,
  manual_id uuid references manuals(id) on delete set null,
  manual_code text,                                    -- when the manual is not yet in S.A.M.
  section_ref text,
  expected text not null,
  status text not null default 'pending' check (status in ('pending','included','deferred','published','verified','removed')),
  revision_id uuid references revisions(id) on delete set null,
  verified_at timestamptz, verified_by uuid references people(id) on delete set null, verified_note text,
  created_at timestamptz not null default now()
);
create index finding_changes_manual on finding_changes (manual_id) where status in ('pending','included','deferred');
alter table finding_changes enable row level security;
drop policy if exists finding_changes_read on finding_changes;
create policy finding_changes_read on finding_changes for select using (true);

-- other corrective actions of the plan: the shared action object, module 'compliance'
alter table safety_actions add column if not exists finding_id uuid references findings(id) on delete set null;
create index if not exists safety_actions_finding on safety_actions (finding_id);

-- a revision published → the changes it includes are 'published' (Compliance then verifies the text)
create or replace function finding_change_follow_revision() returns trigger language plpgsql as $$
begin
  if new.step in ('published','repository') and (old.step is distinct from new.step) then
    update finding_changes set status = 'published' where revision_id = new.id and status = 'included';
  end if;
  return new;
end $$;
drop trigger if exists finding_change_follow_revision on revisions;
create trigger finding_change_follow_revision after update of step on revisions for each row execute function finding_change_follow_revision();

-- Inbox kinds used: finding (NP: answer), finding_review (Compliance: read the answer), finding_closure (NP: closure proposed), status_review
insert into notification_rules (kind, label, remind_days, chase_days, escalate_days, escalate_to, am_days) values
  ('finding_review', 'Finding answer to review', 0, 3, 7, 'CMM', null),
  ('finding_closure', 'Finding closure proposed', 0, 7, 14, 'CMM', null)
on conflict (kind) do nothing;
