-- PRJ-02: documents attached to a project task (deliverables not produced in S.A.M.: contracts, PPI reports, forms, evidence).
create table if not exists project_task_files (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references project_tasks(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  path text,                                -- evidence/<ENT>/projects/<project id>/<task id>/<name>; null = kept on the server, recorded by name
  size int,
  uploaded_by uuid references people(id),
  at timestamptz not null default now()
);
create index if not exists project_task_files_task on project_task_files (task_id, at);
alter table project_task_files enable row level security;
drop policy if exists ptf_scope on project_task_files;
create policy ptf_scope on project_task_files for select to authenticated
  using (exists (select 1 from projects p where p.id = project_id and p.entity = any(my_entities())));
