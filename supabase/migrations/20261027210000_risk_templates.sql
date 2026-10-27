-- New RA / MOC started from a template or from a similar past study, with a few factual questions (SAM adapts the base to the case).
create table if not exists risk_templates (
  id uuid primary key default gen_random_uuid(),
  entity text,                                   -- null = every entity
  kind text not null check (kind in ('ra','moc')),
  name text not null,
  category text,
  domain text,
  description text,
  questions jsonb not null default '[]'::jsonb,  -- [{id,label,hint}]
  hazards jsonb not null default '[]'::jsonb,    -- [{title,consequence,lik_before,sev_before,lik_after,sev_after,existing[],mitigations[{text,owner_role}],log_hazard_id}]
  source_ids uuid[] not null default '{}',       -- past studies it was built from
  status text not null default 'active' check (status in ('proposed','active','retired')),
  uses int not null default 0,
  created_by uuid references people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists risk_templates_scope on risk_templates (kind, entity, status);
alter table risk_templates enable row level security;

alter table risk_assessments add column if not exists based_on_id uuid references risk_assessments(id) on delete set null;
alter table risk_assessments add column if not exists template_id uuid references risk_templates(id) on delete set null;
alter table risk_assessments add column if not exists prefill jsonb;   -- {base:{kind,id,label}, questions:[…], applied:bool, blank:bool}
alter table hazards add column if not exists prefill_note text;        -- what SAM changed compared with the base
