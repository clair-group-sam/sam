-- RIGHTS-04 (25/11, Guillaume) · a post or role is held in one organisation. people.sam_roles keeps each right as "CODE@ENTITY"
-- ("NPFO@ASJMT", "NPFO_DEP@ASJFR"); a right written without "@" is held in every organisation of the person (CMM of the group,
-- SUPERADMIN, and what was given before this change, until Compliance places it).
-- people.roles stays the list of codes held anywhere (what the row-level rules read); people.entities gains the organisations of the
-- rights. Which right applies where is decided by the application from sam_roles.
create or replace function people_apply_rights() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.sam_roles = '{}' and new.sam_entities = '{}' and not new.sam_group then
      new.sam_roles := coalesce(new.roles, '{}'); new.sam_entities := coalesce(new.entities, '{}'); new.sam_group := coalesce(new.is_group_function, false);
    end if;
    return new;
  end if;
  new.roles := coalesce((select array_agg(distinct split_part(x, '@', 1)) from unnest(new.sam_roles) x where x is not null and split_part(x, '@', 1) <> ''), '{}');
  if coalesce(array_length(new.roles, 1), 0) = 0 then new.roles := array['USER']; end if;
  new.entities := coalesce((select array_agg(distinct e) from unnest(
      new.entra_entities || new.sam_entities
      || coalesce((select array_agg(split_part(x, '@', 2)::entity_code) from unnest(new.sam_roles) x where split_part(x, '@', 2) in ('ASJMT', 'ASJFR', 'ASFFR', 'ASTFR')), '{}')
    ) e where e is not null), '{}');
  new.is_group_function := new.entra_group or new.sam_group;
  new.home_entity := coalesce(new.home_entity, new.entities[1]);
  return new;
end $$;
