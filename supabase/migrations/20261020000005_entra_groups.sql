-- Entra groups → S.A.M. scope. The IT reuses existing Microsoft 365 groups (no CG-… naming):
-- the mapping lives here and is administered in Settings › Entra groups sync.
create table if not exists entra_groups (
  group_id text primary key,                 -- GUID from the "groups" claim
  name text,                                 -- display name, typed by the admin (Graph Group.Read.All not granted)
  entity entity_code,                        -- null + is_group_function = group-wide function
  role text,                                 -- CMM, SM, AM, NPFO, NPCA, CFI, HT, CTKI, FSO, MAM, USER, CREW, EXT…
  is_group_function boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz,
  mapped_at timestamptz
);
alter table entra_groups enable row level security;
create policy entra_groups_admin on entra_groups for all to authenticated
  using (has_role('SUPERADMIN') or has_role('CMM')) with check (has_role('SUPERADMIN') or has_role('CMM'));

create or replace function touch_person(p_auth_uid uuid, p_email text, p_name text, p_groups text[])
returns people language plpgsql security definer set search_path = public as $$
declare r people; ents entity_code[] := '{}'; rls text[] := '{}'; grp boolean := false; g text; m text[]; mapped int := 0; eg entra_groups;
begin
  select * into r from people where auth_uid = p_auth_uid or lower(email::text) = lower(p_email) order by (auth_uid = p_auth_uid) desc limit 1;
  if r.id is null then
    insert into people (auth_uid, email, display_name, roles) values (p_auth_uid, p_email, coalesce(nullif(p_name,''), p_email), array['USER'])
    returning * into r;
  end if;
  if p_groups is not null and array_length(p_groups,1) > 0 then
    foreach g in array p_groups loop
      -- legacy naming convention, still honoured
      m := regexp_match(g, '^CG-(ASF|ASJ|AJD|TEC|GROUP)-([A-Z0-9_]+)$');
      if m is not null then
        if m[1] = 'GROUP' then grp := true; else ents := array_append(ents, m[1]::entity_code); end if;
        rls := array_append(rls, m[2]); mapped := mapped + 1;
        continue;
      end if;
      -- Microsoft 365 group id → mapping table
      insert into entra_groups (group_id, last_seen_at) values (g, now())
        on conflict (group_id) do update set last_seen_at = now();
      select * into eg from entra_groups where group_id = g and (entity is not null or is_group_function) and role is not null;
      if eg.group_id is not null then
        if eg.is_group_function then grp := true; else ents := array_append(ents, eg.entity); end if;
        rls := array_append(rls, eg.role); mapped := mapped + 1;
      end if;
    end loop;
    -- Only overwrite the administrator's manual scope when at least one group is mapped.
    if mapped > 0 then
      update people set entities = coalesce((select array_agg(distinct e) from unnest(ents) e), '{}'),
        roles = (select array_agg(distinct x) from unnest(rls) x),
        is_group_function = grp, home_entity = coalesce(home_entity, ents[1]) where id = r.id;
    end if;
  end if;
  update people set auth_uid = coalesce(auth_uid, p_auth_uid), display_name = coalesce(nullif(p_name,''), display_name), last_seen_at = now()
    where id = r.id returning * into r;
  return r;
end $$;
revoke all on function touch_person(uuid, text, text, text[]) from public, anon, authenticated;

-- Superadmin keeps SUPERADMIN whatever the groups say (bootstrap safety for the beta).
create or replace function keep_superadmin() returns trigger language plpgsql as $$
begin
  if old.roles @> array['SUPERADMIN'] and not (new.roles @> array['SUPERADMIN']) then new.roles := array_append(new.roles, 'SUPERADMIN'); new.is_group_function := true; end if;
  return new;
end $$;
drop trigger if exists people_keep_superadmin on people;
create trigger people_keep_superadmin before update on people for each row execute function keep_superadmin();
