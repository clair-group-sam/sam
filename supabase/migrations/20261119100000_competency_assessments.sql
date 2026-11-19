-- NP-03 · Competency assessments (19/11): the house forms ENR-COMP-01 (OPS) and ENR-COMP-02 (CAMO, CAMO.A.305(g), CAME § 2.9)
-- filled in S.A.M. One row per assessment: who, for which position and functions, each point with its level (1 to 4) and remark,
-- the outcome, the training required, and the signature of the assessor. The points are copied on the row when it is created:
-- a later edition of the form never rewrites a signed assessment.
-- Personal data: no read policy. The pages read through the server, which shows an assessment to Compliance, to the assessor
-- and to the person assessed only.
create table if not exists competency_assessments (
  id uuid primary key default gen_random_uuid(),
  entity text not null,
  form text not null check (form in ('OPS','CAMO')),
  form_ref text not null,                          -- "ENR-COMP-02"
  form_edition text,                               -- "Edit. 1 Rev 1, 07/03/2025"
  person_id uuid references people(id) on delete set null,
  person_name text not null,
  position text,
  functions text[] not null default '{}',          -- columns of the form assessed: NPFO, NPCT … / CAM, CMM, SM, AE, ARS, CMS
  kind text not null default 'recurrent' check (kind in ('initial','recurrent')),
  assessed_on date,
  last_assessed_on date,
  assessor_id uuid references people(id) on delete set null,
  assessor_name text,
  org_changes text,                                -- organisational changes during the period that may impact required training
  items jsonb not null default '[]',               -- [{ k, section, text, level, remark }]
  outcome text check (outcome in ('fit','fit_training','not_fit')),
  training_required text,
  diplomas text,                                   -- page 3 of ENR-COMP-02, as written
  trainings text,
  next_due date,
  status text not null default 'draft' check (status in ('draft','signed')),
  signed_at timestamptz,
  signed_by uuid references people(id) on delete set null,
  created_by uuid references people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists competency_assessments_entity on competency_assessments (entity, assessed_on desc);
create index if not exists competency_assessments_person on competency_assessments (person_id);
alter table competency_assessments enable row level security;
