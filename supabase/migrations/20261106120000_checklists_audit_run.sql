-- AUD-02 · Checklists and the audit run (06/11). Model: Centrik Compliance (checklist → sections → checks with the rule, a result, a comment,
-- attachments; completion and breakdown; findings raised from a check) + ENR-OPS-01 (one checklist per audited area, coverage of the regulation).
-- The checklist is a template per entity (codes + links + house guidance); the official text comes from regulation_items at audit time.

create table if not exists checklists (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  code text not null,                                  -- ORG, OP, PER… (= the module code of the programme, usually)
  title text not null,
  domain text,                                         -- OPS, CAMO, ATO, FSTD, CAE
  regulation_id uuid references regulations(id) on delete set null,   -- default EAR of the items
  note text,
  imported_from text,                                  -- Centrik checklist / audit the template was read from
  active boolean not null default true,
  created_by uuid references people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity, code)
);
alter table checklists enable row level security;
drop policy if exists checklists_read on checklists;
create policy checklists_read on checklists for select using (true);

create table if not exists checklist_sections (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references checklists(id) on delete cascade,
  ord int not null default 0,
  code text,
  title text not null
);
create index if not exists checklist_sections_cl on checklist_sections (checklist_id, ord);
alter table checklist_sections enable row level security;
drop policy if exists checklist_sections_read on checklist_sections;
create policy checklist_sections_read on checklist_sections for select using (true);

create table if not exists checklist_items (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references checklists(id) on delete cascade,
  section_id uuid references checklist_sections(id) on delete set null,
  ord int not null default 0,
  code text not null,                                  -- rule code (ORO.GEN.200) or a house code (C1-03)
  ref text,                                            -- a precise ref when the item is one AMC / paragraph: "AMC1 ORO.GEN.200(a)(3)" · "(a)(2)"
  regulation_id uuid references regulations(id) on delete set null,
  question text,                                       -- house wording when the rule code is not enough (checks C1/C2/C3, subcontractors)
  guidance text,                                       -- house guidance: where to look, what to ask
  review_flag boolean not null default false,          -- set when the article changed in a new EAR version
  review_note text,
  active boolean not null default true
);
create index if not exists checklist_items_cl on checklist_items (checklist_id, ord);
create index if not exists checklist_items_code on checklist_items (regulation_id, code);
alter table checklist_items enable row level security;
drop policy if exists checklist_items_read on checklist_items;
create policy checklist_items_read on checklist_items for select using (true);

alter table audit_modules add column if not exists checklist_id uuid references checklists(id) on delete set null;
alter table audits add column if not exists checklist_id uuid references checklists(id) on delete set null;
alter table audits add column if not exists started_on date;
alter table audits add column if not exists report_summary text;        -- conclusion of the audit (report)
alter table audits add column if not exists report_at timestamptz;
alter table audits add column if not exists closed_at timestamptz;
alter table audits add column if not exists closed_by uuid references people(id) on delete set null;
alter table audits add column if not exists imported_from text;

-- the checks of one audit (snapshot of the checklist at start; ad-hoc checks may be added)
create table if not exists audit_checks (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references audits(id) on delete cascade,
  item_id uuid references checklist_items(id) on delete set null,
  ord int not null default 0,
  section text,
  code text not null,
  ref text,
  regulation_id uuid references regulations(id) on delete set null,
  version text,                                        -- EAR version shown to the auditor
  question text, guidance text,
  result text check (result in ('conforming','partial','non_conforming','not_applicable','not_covered')),
  comment text,
  evidence jsonb not null default '[]',                -- [{"name","path","size","at","by"}]
  finding_id uuid references findings(id) on delete set null,
  checked_by uuid references people(id) on delete set null,
  checked_at timestamptz,
  imported jsonb                                       -- Centrik result as read (mirror), when imported
);
create index if not exists audit_checks_audit on audit_checks (audit_id, ord);
create index if not exists audit_checks_code on audit_checks (code);
alter table audit_checks enable row level security;
drop policy if exists audit_checks_read on audit_checks;
create policy audit_checks_read on audit_checks for select using (true);

alter table findings add column if not exists check_id uuid references audit_checks(id) on delete set null;
alter table findings add column if not exists category text;             -- Centrik: Airport, Aircraft, Flight Ops, Ground Ops, Engineering, AOC, Manuals, Other
alter table findings add column if not exists cause text;                -- Centrik: One-off, General practice, Manuals, Other
alter table findings add column if not exists repeat boolean;            -- first / repeat

-- S.A.M.'s help on a rule for an entity: where to look (manual chapters citing it), typical evidence, last results. Cached per EAR version.
create table if not exists regulation_hints (
  id uuid primary key default gen_random_uuid(),
  regulation_id uuid references regulations(id) on delete cascade,
  version text not null,
  code text not null,
  entity entity_code not null references entities(code),
  hints jsonb not null,                                -- {"chapters":[{"manual","ref","why"}],"evidence":["…"],"ask":["…"],"model","at"}
  created_at timestamptz not null default now(),
  unique (regulation_id, version, code, entity)
);
alter table regulation_hints enable row level security;
drop policy if exists regulation_hints_read on regulation_hints;
create policy regulation_hints_read on regulation_hints for select using (true);

insert into storage.buckets (id, name, public, file_size_limit) values ('audits', 'audits', false, 26214400) on conflict (id) do nothing;
