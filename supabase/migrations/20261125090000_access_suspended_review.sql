-- RIGHTS-03 (24/11, Guillaume) · what S.A.M. can do by itself when someone leaves or changes post, without reading the directory.
-- 1 · Access suspended: Compliance (or the super admin) cuts the access of a person in S.A.M., at once, open sessions included.
alter table people add column if not exists suspended_at timestamptz;
alter table people add column if not exists suspended_by uuid references people(id) on delete set null;
alter table people add column if not exists suspended_note text;
-- 3 · Rights to check: the Microsoft groups of a person changed at their last sign-in, or they hold rights and no longer sign in.
alter table people add column if not exists entra_changed_at timestamptz;
alter table people add column if not exists entra_change text;
alter table people add column if not exists rights_reviewed_at timestamptz;
alter table people add column if not exists rights_reviewed_by uuid references people(id) on delete set null;

-- a suspended person is nobody for the row-level rules: no role, no entity
create or replace function me() returns people language sql stable security definer set search_path = public as $$
  select p.* from people p
  where (p.auth_uid = auth.uid() or lower(p.email::text) = lower(auth.jwt()->>'email')) and p.suspended_at is null
  order by (p.auth_uid = auth.uid()) desc limit 1
$$;

-- 2 · sign-in: when Microsoft sends the groups of the person and none of them is known to S.A.M., the entities that came from
-- Microsoft are removed (they were kept from the previous sign-in). What S.A.M. gave stays. A change of the groups is dated and described.
create or replace function touch_person(p_auth_uid uuid, p_email text, p_name text, p_groups text[])
returns people language plpgsql security definer set search_path = public as $$
declare r people; ents entity_code[] := '{}'; rls text[] := '{}'; grp boolean := false; g text; m text[]; eg entra_groups; code text;
  n_ents entity_code[]; n_rls text[]; changed boolean;
begin
  select * into r from people where auth_uid = p_auth_uid or lower(email::text) = lower(p_email) order by (auth_uid = p_auth_uid) desc limit 1;
  if r.id is null then
    insert into people (auth_uid, email, display_name, roles) values (p_auth_uid, p_email, coalesce(nullif(p_name,''), p_email), array['USER'])
    returning * into r;
  end if;
  -- no groups in the token (claim not sent, or too many groups for the token): nothing is known, nothing is touched
  if p_groups is not null and array_length(p_groups,1) > 0 then
    foreach g in array p_groups loop
      m := regexp_match(g, '^CG-(ASFFR|ASJFR|ASJMT|ASTFR|ASF|ASJ|AJD|TEC|GROUP)-([A-Z0-9_]+)$');
      if m is not null then
        code := case m[1] when 'AJD' then 'ASJMT' when 'ASJ' then 'ASJFR' when 'ASF' then 'ASFFR' when 'TEC' then 'ASTFR' else m[1] end;
        if code = 'GROUP' then grp := true; else ents := array_append(ents, code::entity_code); end if;
        rls := array_append(rls, m[2]);
        continue;
      end if;
      insert into entra_groups (group_id, last_seen_at) values (g, now())
        on conflict (group_id) do update set last_seen_at = now();
      select * into eg from entra_groups where group_id = g and (entity is not null or is_group_function) and role is not null;
      if eg.group_id is not null then
        if eg.is_group_function then grp := true; else ents := array_append(ents, eg.entity); end if;
        rls := array_append(rls, eg.role);
      end if;
    end loop;
    n_ents := coalesce((select array_agg(distinct e order by e) from unnest(ents) e where e is not null), '{}');
    n_rls := coalesce((select array_agg(distinct x order by x) from unnest(rls) x where x is not null), '{}');
    changed := r.entra_seen_at is not null and not (r.entra_entities @> n_ents and n_ents @> r.entra_entities and r.entra_roles @> n_rls and n_rls @> r.entra_roles and r.entra_group = grp);
    update people set entra_entities = n_ents, entra_roles = n_rls, entra_group = grp, entra_seen_at = now(),
      entra_changed_at = case when changed then now() else entra_changed_at end,
      entra_change = case when changed then 'Microsoft groups before: ' || coalesce(nullif(array_to_string(r.entra_entities, ', '), ''), 'no entity') || coalesce(' / ' || nullif(array_to_string(r.entra_roles, ', '), ''), '') || case when r.entra_group then ' / group function' else '' end
        || '. Now: ' || coalesce(nullif(array_to_string(n_ents, ', '), ''), 'no entity') || coalesce(' / ' || nullif(array_to_string(n_rls, ', '), ''), '') || case when grp then ' / group function' else '' end || '.' else entra_change end
      where id = r.id;
  end if;
  update people set auth_uid = coalesce(auth_uid, p_auth_uid), display_name = coalesce(nullif(p_name,''), display_name), last_seen_at = now()
    where id = r.id returning * into r;
  return r;
end $$;
revoke all on function touch_person(uuid, text, text, text[]) from public, anon, authenticated;
