-- AUD-03 (09/11) · A "compliance checks" module of the programme shows the recurring checks of Compliance › Compliance checks
-- (their passages and the next due date) instead of one-off audits: one place to record a check, the programme shows coverage.
alter table audit_modules add column if not exists check_ids uuid[] not null default '{}';

-- link by code: module C1 ↔ check C1; module CC ↔ checks CC-01…CC-16 (same entity)
update audit_modules m set check_ids = sub.ids from (
  select m2.id as module_id, array_agg(c.id order by c.code) as ids
    from audit_modules m2 join audit_programmes p on p.id = m2.programme_id
    join compliance_checks c on c.entity = p.entity and c.active
     and (upper(c.code) = upper(m2.code) or upper(c.code) like upper(m2.code) || '-%')
   where m2.kind = 'checks'
   group by m2.id) sub
 where m.id = sub.module_id and m.check_ids = '{}';
