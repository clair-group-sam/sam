-- FND-03 · final flow (30/10): the NP writes the root cause (checked with S.A.M.), then the plan (checked with S.A.M.), then sends both;
-- Compliance accepts both before the plan starts. Drafts live on the finding; each submission is one round carrying both parts.
alter table findings drop constraint if exists findings_status_check;
update findings set status = case when status in ('rca_review','plan_review') then 'review' when status in ('rca_back','plan_back') then 'back' when status = 'plan' then 'open' else status end;
alter table findings add constraint findings_status_check check (status in ('open','review','back','accepted','closure_requested','closed','cancelled'));
alter table findings add column if not exists draft_root_cause text;
alter table findings add column if not exists draft_factors text;
alter table findings add column if not exists draft_immediate text;
alter table findings add column if not exists draft_comment text;
alter table findings add column if not exists draft_step int not null default 1;    -- 1 root cause · 2 plan · 3 ready to send
alter table findings add column if not exists rca_check jsonb;                     -- S.A.M.'s reading of the draft root cause, for the NP
alter table findings add column if not exists plan_check jsonb;                    -- S.A.M.'s reading of the draft plan, for the NP
alter table finding_rounds drop constraint if exists finding_rounds_stage_check;
alter table finding_rounds alter column stage set default 'full';
