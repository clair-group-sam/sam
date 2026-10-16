-- S.A.M. core schema · step 2 of the beta plan (INF-01) · UX-03 scope by entity
create extension if not exists pgcrypto;
create extension if not exists vector;
create extension if not exists pg_trgm;

create type entity_code as enum ('ASF','ASJ','AJD','TEC');

create table entities (
  code entity_code primary key,
  name text not null,
  authority text not null,            -- DSAC, TM-CAD, OSAC
  approvals text[] not null default '{}'
);
insert into entities values
 ('ASF','Astonfly','DSAC',array['ATO','FSTD']),
 ('ASJ','Astonjet SAS','DSAC',array['AOC FR']),
 ('AJD','Astonjet Ltd','TM-CAD',array['AOC MT','CAMO MT.CAMO.0079']),
 ('TEC','Astontec','OSAC',array['Part-CAE FR.CAO.0058']);

-- people: one row per Entra identity; scope and roles are refreshed at each sign-in from the groups claim
create table people (
  id uuid primary key default gen_random_uuid(),
  entra_oid uuid unique,
  email citext unique,
  display_name text not null,
  home_entity entity_code,
  entities entity_code[] not null default '{}',
  roles text[] not null default '{}',          -- CMM, SM, NPFO, NPCA, CFI, HT, AM, FSO, USER, EXT…
  is_group_function boolean not null default false,
  created_at timestamptz not null default now()
);
create extension if not exists citext;

-- helper: current user's row
create or replace function me() returns people language sql stable security definer set search_path = public as $$
  select p.* from people p where p.entra_oid = (auth.jwt()->>'sub')::uuid or p.email = auth.jwt()->>'email' limit 1
$$;
create or replace function my_entities() returns entity_code[] language sql stable as $$
  select coalesce((select case when is_group_function then array['ASF','ASJ','AJD','TEC']::entity_code[] else entities end from me()), '{}')
$$;
create or replace function has_role(r text) returns boolean language sql stable as $$
  select r = any(coalesce((select roles from me()), '{}'))
$$;

-- tasks: everything that lands in the Inbox
create table tasks (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  kind text not null,                 -- action, signature, reading, finding, check, change_request, status_review…
  title text not null,
  detail text,
  due date,
  owner_person uuid references people(id),
  owner_role text,
  status text not null default 'open',
  link text,                          -- route inside S.A.M.
  created_at timestamptz not null default now()
);

-- append-only audit log with chained hash
create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor uuid,
  entity entity_code,
  object_type text not null,
  object_id text not null,
  action text not null,
  before jsonb,
  after jsonb,
  prev_hash text,
  hash text
);
create or replace function audit_chain() returns trigger language plpgsql as $$
declare prev text;
begin
  select hash into prev from audit_log order by id desc limit 1;
  new.prev_hash := prev;
  new.hash := encode(digest(coalesce(prev,'') || new.at::text || new.object_type || new.object_id || new.action || coalesce(new.after::text,''), 'sha256'), 'hex');
  return new;
end $$;
create trigger audit_chain_trg before insert on audit_log for each row execute function audit_chain();
revoke update, delete on audit_log from public, anon, authenticated;

-- RLS
alter table entities enable row level security;
alter table people enable row level security;
alter table tasks enable row level security;
alter table audit_log enable row level security;
create policy entities_read on entities for select to authenticated using (true);
create policy people_self on people for select to authenticated using (entra_oid = (auth.jwt()->>'sub')::uuid or has_role('CMM') or has_role('SM'));
create policy tasks_scope on tasks for select to authenticated using (entity = any(my_entities()));
create policy tasks_write on tasks for insert to authenticated with check (entity = any(my_entities()));
create policy tasks_update on tasks for update to authenticated using (entity = any(my_entities()));
create policy audit_registers on audit_log for select to authenticated using (has_role('CMM') or has_role('SM') or has_role('AM'));
