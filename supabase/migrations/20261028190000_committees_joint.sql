-- SAF-05 · Joint meetings (one meeting for AJD and ASJ together): ONE committee record with the entities it was held for.
-- Each entity's auditor sees the same meeting, the same minutes and every action decided (MSM §4.5 / §4.6, record kept once).
alter table committees add column if not exists entities entity_code[] not null default '{}';
update committees set entities = array[entity] where entities = '{}';
create index if not exists committees_entities on committees using gin (entities);
drop policy if exists committees_read on committees;
create policy committees_read on committees for select to authenticated using (entities && my_entities());

-- the Centrik joint meetings imported twice (source_ref '<case>:<ENT>') become one record: the first copy is kept for all its entities,
-- the actions of the second copy are identical (same Centrik action number) and are removed with their Inbox tasks — nothing else differs.
-- the import journals of the removed copies go with them (append-only triggers lifted for this clean-up only)
alter table safety_action_events disable trigger safety_action_events_ro;
alter table committee_events disable trigger committee_events_ro;
do $$
declare k record; keep uuid; ents entity_code[];
begin
  for k in select split_part(source_ref, ':', 1) as case_id from committees where source = 'centrik' and source_ref like '%:%' group by 1 loop
    select id into keep from committees where source = 'centrik' and source_ref like k.case_id || ':%' order by created_at, number limit 1;
    select array_agg(distinct entity) into ents from committees where source = 'centrik' and source_ref like k.case_id || ':%';
    delete from tasks where kind = 'action' and ref_id in (
      select a.id from safety_actions a join committees c on c.id = a.committee_id
      where c.source = 'centrik' and c.source_ref like k.case_id || ':%' and c.id <> keep
        and exists (select 1 from safety_actions b where b.committee_id = keep and b.number = a.number));
    delete from safety_actions a using committees c where c.id = a.committee_id and c.source = 'centrik' and c.source_ref like k.case_id || ':%' and c.id <> keep
      and exists (select 1 from safety_actions b where b.committee_id = keep and b.number = a.number);
    update safety_actions set committee_id = keep where committee_id in (select id from committees where source = 'centrik' and source_ref like k.case_id || ':%' and id <> keep);
    delete from committees where source = 'centrik' and source_ref like k.case_id || ':%' and id <> keep;
    update committees set entities = ents, source_ref = k.case_id, number = regexp_replace(number, '-(AJD|ASJ|ASF|TEC)$', '') where id = keep;
  end loop;
end $$;
alter table safety_action_events enable trigger safety_action_events_ro;
alter table committee_events enable trigger committee_events_ro;
