-- FB-029 · Duplicate revisions (same manual, issue and rev) — seen on sam-dev: TEC CAE "Iss 1 Rev 04" twice
-- (published 2026-01-19 and 2025-11-12). Run the SELECT first, read it, then the fix inside the transaction.
-- The import now updates an existing (manual, issue, rev) instead of inserting (app/(app)/set/integ/actions.ts).

-- 1 · what is duplicated
select m.entity, m.code, r.issue, r.rev, r.id, r.step, r.published_at, r.created_at,
       (select count(*) from revision_sections s where s.revision_id = r.id) as sections,
       (select count(*) from readings x where x.revision_id = r.id) as readings,
       (select count(*) from authority_files a where a.revision_id = r.id) as files
from revisions r join manuals m on m.id = r.manual_id
where (r.manual_id, r.issue, r.rev) in (
  select manual_id, issue, rev from revisions group by manual_id, issue, rev having count(*) > 1)
order by m.entity, m.code, r.issue, r.rev, r.published_at desc nulls last;

-- 2 · keep, for each (manual, issue, rev), the most recently published one; remove the others
--     only when nobody has acknowledged them and no authority file points to them.
begin;
with ranked as (
  select r.id, row_number() over (partition by r.manual_id, r.issue, r.rev order by r.published_at desc nulls last, r.created_at desc) as rn
  from revisions r),
losers as (
  select id from ranked where rn > 1
    and not exists (select 1 from readings x where x.revision_id = ranked.id)
    and not exists (select 1 from authority_files a where a.revision_id = ranked.id)
    and not exists (select 1 from revisions b where b.based_on = ranked.id))
delete from revision_sections where revision_id in (select id from losers);
with ranked as (
  select r.id, row_number() over (partition by r.manual_id, r.issue, r.rev order by r.published_at desc nulls last, r.created_at desc) as rn
  from revisions r)
delete from revisions where id in (
  select id from ranked where rn > 1
    and not exists (select 1 from readings x where x.revision_id = ranked.id)
    and not exists (select 1 from authority_files a where a.revision_id = ranked.id)
    and not exists (select 1 from revisions b where b.based_on = ranked.id));
-- 3 · never again
create unique index if not exists revisions_manual_issue_rev_uq on revisions (manual_id, issue, rev);
commit;
