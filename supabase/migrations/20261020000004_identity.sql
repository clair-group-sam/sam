-- Identity: link Supabase auth users to people, refresh scope at sign-in, seed the CMM.
-- auth.jwt()->>'sub' is the Supabase auth user id (not the Entra object id): store it apart.
alter table people add column if not exists auth_uid uuid unique;
alter table people add column if not exists job_title text;
alter table people add column if not exists last_seen_at timestamptz;

create or replace function me() returns people language sql stable security definer set search_path = public as $$
  select p.* from people p
  where p.auth_uid = auth.uid() or lower(p.email::text) = lower(auth.jwt()->>'email')
  order by (p.auth_uid = auth.uid()) desc limit 1
$$;

drop policy if exists people_self on people;
create policy people_self on people for select to authenticated
  using (auth_uid = auth.uid() or lower(email::text) = lower(auth.jwt()->>'email') or has_role('CMM') or has_role('SM') or has_role('AM'));

-- Called by the app (service role) right after sign-in. Groups come from the Entra token when the IT has enabled the claim;
-- when absent, the scope set by the administrator in the people table is kept (fallback so the beta is not blocked).
create or replace function touch_person(p_auth_uid uuid, p_email text, p_name text, p_groups text[])
returns people language plpgsql security definer set search_path = public as $$
declare r people; ents entity_code[] := '{}'; rls text[] := '{}'; grp boolean := false; g text; m text[];
begin
  select * into r from people where auth_uid = p_auth_uid or lower(email::text) = lower(p_email) order by (auth_uid = p_auth_uid) desc limit 1;
  if r.id is null then
    insert into people (auth_uid, email, display_name, roles) values (p_auth_uid, p_email, coalesce(nullif(p_name,''), p_email), array['USER'])
    returning * into r;
  end if;
  if p_groups is not null and array_length(p_groups,1) > 0 then
    foreach g in array p_groups loop
      m := regexp_match(g, '^CG-(ASF|ASJ|AJD|TEC|GROUP)-([A-Z0-9_]+)$');
      if m is not null then
        if m[1] = 'GROUP' then grp := true; else ents := array_append(ents, m[1]::entity_code); end if;
        rls := array_append(rls, m[2]);
      end if;
    end loop;
    if array_length(rls,1) > 0 then
      update people set entities = (select array_agg(distinct e) from unnest(ents) e), roles = (select array_agg(distinct x) from unnest(rls) x),
        is_group_function = grp, home_entity = coalesce(home_entity, ents[1]) where id = r.id;
    end if;
  end if;
  update people set auth_uid = coalesce(auth_uid, p_auth_uid), display_name = coalesce(nullif(p_name,''), display_name), last_seen_at = now()
    where id = r.id returning * into r;
  return r;
end $$;
revoke all on function touch_person(uuid, text, text, text[]) from public, anon, authenticated;

-- Seed: the CMM / SM is a group function (sees the four entities). Linked to the auth user at first sign-in by e-mail.
insert into people (email, display_name, home_entity, entities, roles, is_group_function, job_title)
values ('guillaume.fournie@clair-group.com', 'Guillaume Fournie', 'ASJ', array['ASF','ASJ','AJD','TEC']::entity_code[], array['CMM','SM','SUPERADMIN'], true, 'CMM / SM · Super admin')
on conflict (email) do update set roles = excluded.roles, is_group_function = true, entities = excluded.entities, job_title = excluded.job_title;
