-- FB-109 · One clean-up of the test objects left on sam-dev by the test sessions (also covers FB-064).
-- RUN ON sam-dev ON 10/11/2026: the 10 objects were removed. Kept as a record and for a later test campaign.
-- Audit numbers without a prefix (FB-095) are NOT repaired here: the right prefix is a decision, not a guess.
-- Run in the Supabase SQL editor of sam-dev. Step 1 only reads. Step 2 changes data inside one transaction:
-- read the NOTICE lines, then COMMIT (or ROLLBACK to change nothing). An object that something real still
-- points to is NOT removed: its NOTICE says which one, and the rest goes on.
-- The duplicate "CAE Iss 1 Rev 04" is handled by scripts/fix-duplicate-revisions.sql (FB-029).

-- 1 · what would be touched
select 'report' as what, id::text as ref, headline as title from reports where id in ('2026-001','2026-003') and headline ilike '%test%'
union all select 'safety promotion', number, title from safety_promotions where title ilike 'TEST%'
union all select 'risk assessment', number, name from risk_assessments where number ilike 'test%'
union all select 'manual', entity || ' ' || code, title from manuals where code in ('TEST','TEST-CHART')
union all select 'authority file', stage, title from authority_files where title ilike '%9HTEST%' or title = 'TEST carte team';

-- 2 · the clean-up
begin;
do $$
declare r record;
begin
  for r in select id, headline from reports where id in ('2026-001','2026-003') and headline ilike '%test%' loop
    begin delete from reports where id = r.id; raise notice 'report % removed', r.id;
    exception when foreign_key_violation then raise notice 'report % kept: still referenced (%). Close it instead.', r.id, sqlerrm; end;
  end loop;

  for r in select id, number from safety_promotions where title ilike 'TEST%' loop
    begin delete from safety_promotion_reads where promotion_id = r.id; delete from safety_promotions where id = r.id; raise notice 'safety promotion % removed', r.number;
    exception when others then raise notice 'safety promotion % kept: %', r.number, sqlerrm; end;
  end loop;

  for r in select id, number from risk_assessments where number ilike 'test%' loop
    begin delete from risk_assessments where id = r.id; raise notice 'risk assessment % removed', r.number;
    exception when foreign_key_violation then raise notice 'risk assessment % kept: still referenced (%)', r.number, sqlerrm; end;
  end loop;

  for r in select id, title from authority_files where title ilike '%9HTEST%' or title = 'TEST carte team' loop
    begin delete from authority_files where id = r.id; raise notice 'authority file "%" removed', r.title;
    exception when foreign_key_violation then raise notice 'authority file "%" kept: still referenced (%)', r.title, sqlerrm; end;
  end loop;

  for r in select id, entity, code from manuals where code in ('TEST','TEST-CHART') loop
    begin
      delete from revisions where manual_id = r.id;
      delete from manuals where id = r.id;
      raise notice 'manual % % removed', r.entity, r.code;
    exception when foreign_key_violation then raise notice 'manual % % kept: still referenced (%)', r.entity, r.code, sqlerrm; end;
  end loop;
end $$;
-- read the notices above, then:
-- commit;
-- rollback;
