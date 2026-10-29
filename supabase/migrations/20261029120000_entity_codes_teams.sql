-- ENT-01 (meeting 29/10/2026): the entity codes are the Teams codes of the companies.
-- AJD → ASJMT (Astonjet Ltd, Malta) · ASJ → ASJFR (Astonjet SAS, France) · ASF → ASFFR (Astonfly) · TEC → ASTFR (Astontec).
-- Renaming the enum values updates every column of type entity_code / entity_code[] at once; text columns are updated below.
-- Numbers already issued (ACT-AJD-2026-001, HZ-ASJ-0007…) are identifiers and are kept as they are.
alter type entity_code rename value 'AJD' to 'ASJMT';
alter type entity_code rename value 'ASJ' to 'ASJFR';
alter type entity_code rename value 'ASF' to 'ASFFR';
alter type entity_code rename value 'TEC' to 'ASTFR';

do $$
declare c record; n int;
begin
  for c in select table_name, column_name, data_type from information_schema.columns
           where table_schema = 'public' and column_name in ('entity','home_entity','entities')
             and (data_type = 'text' or (data_type = 'ARRAY' and udt_name = '_text'))
             and table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE') loop
    begin
      if c.data_type = 'text' then
        execute format('update %I set %I = case %I when ''AJD'' then ''ASJMT'' when ''ASJ'' then ''ASJFR'' when ''ASF'' then ''ASFFR'' when ''TEC'' then ''ASTFR'' end where %I in (''AJD'',''ASJ'',''ASF'',''TEC'')', c.table_name, c.column_name, c.column_name, c.column_name);
      else
        execute format('update %I set %I = (select array_agg(case x when ''AJD'' then ''ASJMT'' when ''ASJ'' then ''ASJFR'' when ''ASF'' then ''ASFFR'' when ''TEC'' then ''ASTFR'' else x end) from unnest(%I) x) where %I && array[''AJD'',''ASJ'',''ASF'',''TEC'']', c.table_name, c.column_name, c.column_name, c.column_name);
      end if;
      get diagnostics n = row_count; if n > 0 then raise notice '% .% : % rows', c.table_name, c.column_name, n; end if;
    exception when others then raise notice 'skipped %.% (%)', c.table_name, c.column_name, sqlerrm;
    end;
  end loop;
end $$;

create or replace function my_entities() returns entity_code[] language sql stable as $$
  select coalesce((select case when is_group_function then array['ASFFR','ASJFR','ASJMT','ASTFR']::entity_code[] else entities end from me()), '{}')
$$;

-- sign-in: legacy group names CG-<AJD|ASJ|ASF|TEC>-<ROLE> are still honoured and mapped to the new codes
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
