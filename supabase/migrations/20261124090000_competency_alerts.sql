-- NP-03 (24/11) · competency assessments: the alerts already raised before the end of validity (60 / 30 / 7 days, expired), so that
-- the daily run raises each one once.
alter table competency_assessments add column if not exists alerts jsonb not null default '{}';

-- NP-02 (24/11) · a notice set by the authority itself for a change of nominated person (in days): the longest of this one and of
-- the regulation applies.
alter table np_changes add column if not exists authority_notice_days int;
