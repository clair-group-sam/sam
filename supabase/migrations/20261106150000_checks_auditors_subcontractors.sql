-- COMP-04/05/06 (06/11) · Compliance checks (recurring controls, distinct from audits — ENR-OPS-01 C1..C3, ENR-ATO-01 CC-01..16),
-- Internal auditors (ENR-CM-09 / PRO-CM-04: qualification, independence, approval, validity), Subcontractors (ENR-CM-11: contract, clauses, control).

create table if not exists compliance_checks (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  code text not null,                                  -- C1, CC-07
  title text not null,
  reference text,                                      -- ORA.ATO.140 · ORO.GEN.200(a)(6)
  domain text,
  checklist_id uuid references checklists(id) on delete set null,   -- when the check runs a short checklist
  every_months int not null default 6,
  owner_role text, owner_person uuid references people(id) on delete set null,
  last_done_on date, next_due date,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (entity, code)
);
alter table compliance_checks enable row level security;
drop policy if exists compliance_checks_read on compliance_checks;
create policy compliance_checks_read on compliance_checks for select using (true);

create table if not exists compliance_check_runs (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references compliance_checks(id) on delete cascade,
  done_on date not null default current_date,
  done_by uuid references people(id) on delete set null,
  result text not null check (result in ('conforming','partial','non_conforming')),
  sample text,                                         -- what was sampled (5 flights of October…)
  comment text,
  evidence jsonb not null default '[]',
  finding_id uuid references findings(id) on delete set null,
  audit_id uuid references audits(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists compliance_check_runs_check on compliance_check_runs (check_id, done_on desc);
alter table compliance_check_runs enable row level security;
drop policy if exists compliance_check_runs_read on compliance_check_runs;
create policy compliance_check_runs_read on compliance_check_runs for select using (true);

create table if not exists auditors (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  entities entity_code[] not null default '{}',
  domains text[] not null default '{}',                -- OPS, CAMO, ATO, FSTD, CAE, Safety, Part-IS, Ground Ops, Training…
  exclusions text[] not null default '{}',             -- cannot audit: own departments
  lead boolean not null default false,
  status text not null default 'in_qualification' check (status in ('in_qualification','approved','suspended','withdrawn')),
  approved_by uuid references people(id) on delete set null, approved_on date, valid_until date,
  external text,                                       -- company when the auditor is not staff (TTF…)
  note text,
  created_at timestamptz not null default now(),
  unique (person_id)
);
alter table auditors enable row level security;
drop policy if exists auditors_read on auditors;
create policy auditors_read on auditors for select using (true);

-- qualification checklist (PRO-CM-04): training, regulatory knowledge, observer / co-auditor experience, independence declared, recurrent ≤ 36 months, AM approval
create table if not exists auditor_items (
  id uuid primary key default gen_random_uuid(),
  auditor_id uuid not null references auditors(id) on delete cascade,
  ord int not null default 0,
  label text not null,
  done boolean not null default false,
  evidence text,                                       -- course, date, reference
  on_date date,
  valid_until date
);
alter table auditor_items enable row level security;
drop policy if exists auditor_items_read on auditor_items;
create policy auditor_items_read on auditor_items for select using (true);

create table if not exists auditor_docs (
  id uuid primary key default gen_random_uuid(),
  auditor_id uuid not null references auditors(id) on delete cascade,
  name text not null, kind text,                       -- training, approval, independence, other
  path text, size int,
  issued_on date, valid_until date,
  uploaded_by uuid references people(id) on delete set null,
  at timestamptz not null default now()
);
alter table auditor_docs enable row level security;
drop policy if exists auditor_docs_read on auditor_docs;
create policy auditor_docs_read on auditor_docs for select using (true);

create table if not exists subcontractors (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  code text,                                           -- 3P 1
  name text not null,
  service text,                                        -- FSTD C680 training · e-learning · ops software
  domain text,
  approval_ref text,                                   -- EU-A0268, FR.ATO.xxx, MT.145.xxx
  contract_ref text, contract_from date, contract_until date,
  access_clause boolean,                               -- authority / operator access to the subcontractor (ORO.GEN.205)
  is_clause boolean,                                   -- Part-IS clauses (AMC1 IS.I.OR.205(b))
  every_months int not null default 12,                -- control cadence (audit or documentary review)
  contact text,
  status_note text,
  active boolean not null default true,
  imported_from text,
  created_at timestamptz not null default now()
);
create index if not exists subcontractors_entity on subcontractors (entity, active);
alter table subcontractors enable row level security;
drop policy if exists subcontractors_read on subcontractors;
create policy subcontractors_read on subcontractors for select using (true);

alter table audits add column if not exists subcontractor_id uuid references subcontractors(id) on delete set null;
alter table audit_modules add column if not exists subcontractor_id uuid references subcontractors(id) on delete set null;

-- AJD contracted activities of ENR-OPS-01 Ed.04 Rev.02 (3P 1-14), as listed in the plan
insert into subcontractors (entity, code, name, service, domain, imported_from) values
 ('ASJMT','3P 1','CAE Dubai','Type rating / recurrent training (FSTD)','OPS','ENR-OPS-01 Ed.04 Rev.02'),
 ('ASJMT','3P 2','CAE Vienna','Type rating / recurrent training (FSTD)','OPS','ENR-OPS-01 Ed.04 Rev.02'),
 ('ASJMT','3P 3','CAE UK','Type rating / recurrent training (FSTD)','OPS','ENR-OPS-01 Ed.04 Rev.02'),
 ('ASJMT','3P 4','MERMOZ (ATO)','Training','OPS','ENR-OPS-01 Ed.04 Rev.02'),
 ('ASJMT','3P 5','EFSTC Cannes','Training','OPS','ENR-OPS-01 Ed.04 Rev.02'),
 ('ASJMT','3P 6','Flight Safety FR','Training','OPS','ENR-OPS-01 Ed.04 Rev.02'),
 ('ASJMT','3P 7','Flight Safety Lutz USA (FSTD C680) EU-A0158','FSTD C680','OPS','ENR-OPS-01 Ed.04 Rev.02'),
 ('ASJMT','3P 8','Flight Safety Farnborough UK (FSTD C680) EU-A0268','FSTD C680','OPS','ENR-OPS-01 Ed.04 Rev.02'),
 ('ASJMT','3P 9','Flight Safety Wichita USA (FSTD C680) EU-A0056 & EU-A0113','FSTD C680','OPS','ENR-OPS-01 Ed.04 Rev.02'),
 ('ASJMT','3P 10','Leon','Ops software (scheduling, journey log)','OPS','ENR-OPS-01 Ed.04 Rev.02'),
 ('ASJMT','3P 11','ISTC Malta','Training','OPS','ENR-OPS-01 Ed.04 Rev.02'),
 ('ASJMT','3P 12','CAE Montreal','Type rating / recurrent training (FSTD)','OPS','ENR-OPS-01 Ed.04 Rev.02'),
 ('ASJMT','3P 13','ScandLearn (e-learning)','E-learning','OPS','ENR-OPS-01 Ed.04 Rev.02'),
 ('ASJMT','3P 14','C2 consult','Consulting / training','OPS','ENR-OPS-01 Ed.04 Rev.02')
on conflict do nothing;

-- AJD recurring checks of the plan (C1..C3), twice a year
insert into compliance_checks (entity, code, title, reference, domain, every_months, owner_role) values
 ('ASJMT','C1','Flight package (min 5 checks per audit)','ORO.GEN.200(a)(6) · CAT.OP.MPA','OPS',6,'CMM'),
 ('ASJMT','C2','ARINC (performance & W&B)','CAT.POL.A · CAT.POL.MAB','OPS',6,'CMM'),
 ('ASJMT','C3','Aircraft library','CAT.GEN.MPA.180 · ORO.MLR.100','OPS',6,'CMM')
on conflict do nothing;
