-- RIGHTS-02 (24/11, Guillaume) · rights on two levels.
--   Level 1 · Microsoft Entra says who the person is and gives the base scope: the entities and the group function carried by their
--             Microsoft 365 groups. The posts those groups are mapped to are kept as a suggestion only.
--   Level 2 · S.A.M. gives the rights: the posts (NP management › Changes & approvals) and the roles given in Users & fleet › People.
--             They are no longer overwritten at sign-in.
-- people.roles / entities / is_group_function stay the columns everything reads; they are now derived:
--   roles = sam_roles (USER when empty) · entities = entra_entities ∪ sam_entities · is_group_function = entra_group or sam_group.
alter table people add column if not exists sam_roles text[] not null default '{}';
alter table people add column if not exists sam_entities entity_code[] not null default '{}';
alter table people add column if not exists sam_group boolean not null default false;
alter table people add column if not exists entra_roles text[] not null default '{}';
alter table people add column if not exists entra_entities entity_code[] not null default '{}';
alter table people add column if not exists entra_group boolean not null default false;
alter table people add column if not exists entra_seen_at timestamptz;

-- Nobody loses anything: what each person holds today becomes what S.A.M. gives them.
update people set sam_roles = roles, sam_entities = entities, sam_group = is_group_function
  where sam_roles = '{}' and sam_entities = '{}' and not sam_group;

create or replace function people_apply_rights() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    -- a person created with roles written directly (import, seed): they are what S.A.M. gives
    if new.sam_roles = '{}' and new.sam_entities = '{}' and not new.sam_group then
      new.sam_roles := coalesce(new.roles, '{}'); new.sam_entities := coalesce(new.entities, '{}'); new.sam_group := coalesce(new.is_group_function, false);
    end if;
    return new;
  end if;
  new.roles := coalesce((select array_agg(distinct x) from unnest(new.sam_roles) x where x is not null and x <> ''), '{}');
  if coalesce(array_length(new.roles, 1), 0) = 0 then new.roles := array['USER']; end if;
  new.entities := coalesce((select array_agg(distinct e) from unnest(new.entra_entities || new.sam_entities) e where e is not null), '{}');
  new.is_group_function := new.entra_group or new.sam_group;
  new.home_entity := coalesce(new.home_entity, new.entities[1]);
  return new;
end $$;
-- named so that it runs before people_keep_superadmin (triggers fire in alphabetical order): SUPERADMIN is never lost
drop trigger if exists people_apply_rights_ins on people;
create trigger people_apply_rights_ins before insert on people for each row execute function people_apply_rights();
drop trigger if exists people_apply_rights_upd on people;
create trigger people_apply_rights_upd before update of sam_roles, sam_entities, sam_group, entra_roles, entra_entities, entra_group on people
  for each row execute function people_apply_rights();

-- sign-in: Entra gives the identity and the base scope; the posts of the mapped groups are stored as a suggestion (entra_roles)
create or replace function touch_person(p_auth_uid uuid, p_email text, p_name text, p_groups text[])
returns people language plpgsql security definer set search_path = public as $$
declare r people; ents entity_code[] := '{}'; rls text[] := '{}'; grp boolean := false; g text; m text[]; mapped int := 0; eg entra_groups; code text;
begin
  select * into r from people where auth_uid = p_auth_uid or lower(email::text) = lower(p_email) order by (auth_uid = p_auth_uid) desc limit 1;
  if r.id is null then
    insert into people (auth_uid, email, display_name, roles) values (p_auth_uid, p_email, coalesce(nullif(p_name,''), p_email), array['USER'])
    returning * into r;
  end if;
  if p_groups is not null and array_length(p_groups,1) > 0 then
    foreach g in array p_groups loop
      m := regexp_match(g, '^CG-(ASFFR|ASJFR|ASJMT|ASTFR|ASF|ASJ|AJD|TEC|GROUP)-([A-Z0-9_]+)$');
      if m is not null then
        code := case m[1] when 'AJD' then 'ASJMT' when 'ASJ' then 'ASJFR' when 'ASF' then 'ASFFR' when 'TEC' then 'ASTFR' else m[1] end;
        if code = 'GROUP' then grp := true; else ents := array_append(ents, code::entity_code); end if;
        rls := array_append(rls, m[2]); mapped := mapped + 1;
        continue;
      end if;
      insert into entra_groups (group_id, last_seen_at) values (g, now())
        on conflict (group_id) do update set last_seen_at = now();
      select * into eg from entra_groups where group_id = g and (entity is not null or is_group_function) and role is not null;
      if eg.group_id is not null then
        if eg.is_group_function then grp := true; else ents := array_append(ents, eg.entity); end if;
        rls := array_append(rls, eg.role); mapped := mapped + 1;
      end if;
    end loop;
    if mapped > 0 then
      update people set entra_entities = coalesce((select array_agg(distinct e) from unnest(ents) e), '{}'),
        entra_roles = coalesce((select array_agg(distinct x) from unnest(rls) x), '{}'),
        entra_group = grp, entra_seen_at = now() where id = r.id;
    end if;
  end if;
  update people set auth_uid = coalesce(auth_uid, p_auth_uid), display_name = coalesce(nullif(p_name,''), display_name), last_seen_at = now()
    where id = r.id returning * into r;
  return r;
end $$;
revoke all on function touch_person(uuid, text, text, text[]) from public, anon, authenticated;
