-- NP-03 · Competency assessments (19/11, after Guillaume's review): the person pre-fills their sheet, then Compliance validates and
-- signs (MSM 1.5.2: the CMM performs the competency assessment of the nominated persons and of the auditors).
-- New state "submitted" (pre-filled, sent to Compliance). The person's own level and comment live on each item (self, self_remark).
alter table competency_assessments drop constraint if exists competency_assessments_status_check;
alter table competency_assessments add constraint competency_assessments_status_check check (status in ('draft','submitted','signed'));
alter table competency_assessments add column if not exists submitted_at timestamptz;
