-- AI-01: one Claude Platform account for the group; every call is logged for budgets (user, entity, agent, model, tokens, cost).
-- No link to documents or edits: the document history only shows the person who made the change.
create table if not exists ai_usage (
  id bigserial primary key,
  at timestamptz not null default now(),
  person_id uuid references people(id),
  entity entity_code,
  agent text not null,              -- draft, rewrite, translate, check, review…
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_eur numeric(10,4) not null default 0,
  ok boolean not null default true,
  error text
);
alter table ai_usage enable row level security;
create policy ai_usage_registers on ai_usage for select to authenticated using (has_role('CMM') or has_role('SM') or has_role('AM') or has_role('SUPERADMIN'));
