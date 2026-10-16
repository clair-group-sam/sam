-- Documents · DOC-01 manual as the unit · DOC-09 steps · DOC-10 certificates
create type revision_step as enum ('draft','approved_np','approved_compliance','signed','with_civil_aviation','published','repository');

create table manuals (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  code text not null,                 -- OM-A, MSM, CAME, AMP-C68A…
  title text not null,
  owner_role text not null,           -- NPFO, NPCA, CMM…
  needs_signature boolean not null default false,
  to_tmcad_repository boolean not null default false,
  aircraft_types text[] not null default '{}',
  path text,                          -- folder as in Web Manuals
  unique (entity, code)
);
create table revisions (
  id uuid primary key default gen_random_uuid(),
  manual_id uuid not null references manuals(id),
  issue int not null default 1,
  rev text not null,
  step revision_step not null default 'draft',
  authority_route text,               -- notification | approval | none
  authority_ref text,                 -- TM-CAD application / METEOR dossier id (one file per revision, DOC-09)
  summary text,
  published_at date,
  pdf_path text,                      -- storage: manuals/<entity>/<code>/<rev>.pdf
  created_by uuid references people(id),
  created_at timestamptz not null default now()
);
create table revision_sections (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references revisions(id) on delete cascade,
  ord int not null,
  ref text not null,                  -- 1.3.4
  title text,
  body jsonb not null default '{}',
  body_text text generated always as (coalesce(body->>'text','')) stored,
  changed boolean not null default false
);
create index revision_sections_fts on revision_sections using gin (to_tsvector('simple', coalesce(title,'') || ' ' || body_text));
create table authority_rounds (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references revisions(id) on delete cascade,
  at date not null,
  direction text not null check (direction in ('sent','received')),
  who text not null,
  note text not null
);
create table readings (
  revision_id uuid not null references revisions(id) on delete cascade,
  person_id uuid not null references people(id),
  acknowledged_at timestamptz,
  via text,                            -- app | teams | offline
  primary key (revision_id, person_id)
);
create table certificates (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  scope text not null,                 -- organisation | aircraft
  registration text,
  kind text not null,                  -- AOC, OpSpecs, CAMO, ATO, insurance, ARC, CofA, radio, noise
  title text not null,
  issuer text,
  valid_until date,
  file_path text
);
alter table manuals enable row level security; alter table revisions enable row level security; alter table revision_sections enable row level security;
alter table authority_rounds enable row level security; alter table readings enable row level security; alter table certificates enable row level security;
create policy manuals_scope on manuals for select to authenticated using (entity = any(my_entities()));
create policy revisions_scope on revisions for select to authenticated using (exists (select 1 from manuals m where m.id = manual_id and m.entity = any(my_entities())));
create policy sections_scope on revision_sections for select to authenticated using (exists (select 1 from revisions r join manuals m on m.id = r.manual_id where r.id = revision_id and m.entity = any(my_entities())));
create policy rounds_compliance on authority_rounds for select to authenticated using (has_role('CMM'));
create policy readings_own on readings for all to authenticated using (person_id = (select id from me()) or has_role('CMM') or has_role('SM'));
create policy certificates_scope on certificates for select to authenticated using (entity = any(my_entities()));
