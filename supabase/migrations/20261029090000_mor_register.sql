-- SAF-06 MOR / ECCAIRS (step 5): register of mandatory occurrence reports per entity — 72 h from receipt in S.A.M. (376/2014 art. 4(8)),
-- follow-up reports to the authority: preliminary results within 30 days, final results within 3 months (376/2014 art. 13(4)).
alter table reports add column if not exists mor_authority text;          -- TM-CAD · DGAC (DSAC) · BEA …
alter table reports add column if not exists mor_followup_at timestamptz; -- 30-day report sent
alter table reports add column if not exists mor_followup_ref text;
alter table reports add column if not exists mor_final_at timestamptz;    -- 3-month (final) report sent
alter table reports add column if not exists mor_final_ref text;
create index if not exists reports_mor on reports (entity, mor_filed_at) where mor_filed_at is not null;
