-- COMP reset (10/11, Guillaume) · Astonfly and Astontec start again from the plan: every audit, programme and finding of ASFFR / ASTFR is removed.
-- Kept: compliance checks, auditors, subcontractors, regulatory watch, regulation. Re-import follows (ENR-ATO-01 Ed2 Rev4, Monday « Compliance Software »,
-- CAE §B.1/B.2/B.7 for Astontec). Idempotent; entity-scoped; never touches ASJMT / ASJFR.
do $$
declare ents entity_code[] := array['ASFFR','ASTFR']::entity_code[];
begin
  -- Inbox items pointing at those objects
  delete from tasks where ref_id in (select id from findings where entity = any(ents));
  delete from tasks where ref_id in (select id from audits where entity = any(ents));
  delete from tasks where ref_id in (select id from audit_programmes where entity = any(ents));
  -- actions raised by those findings (compliance module)
  delete from safety_actions where finding_id in (select id from findings where entity = any(ents));
  -- check runs keep their result, lose the link
  update compliance_check_runs set finding_id = null where finding_id in (select id from findings where entity = any(ents));
  -- findings (rounds and expected changes cascade)
  delete from findings where entity = any(ents);
  -- audits: the events journal is append-only, released for this reset only
  alter table audit_events disable trigger audit_events_no_change;
  delete from audit_events where audit_id in (select id from audits where entity = any(ents));
  delete from audit_checks where audit_id in (select id from audits where entity = any(ents));
  delete from audits where entity = any(ents);
  alter table audit_events enable trigger audit_events_no_change;
  -- programmes (modules cascade)
  delete from audit_programmes where entity = any(ents);
end $$;
