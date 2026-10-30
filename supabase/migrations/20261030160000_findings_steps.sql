-- FND-03 · the NP's analysis goes step by step (30/10): 1 root cause (accepted by Compliance) → 2 action plan (accepted by Compliance) → plan in progress → closure.
alter table findings drop constraint if exists findings_status_check;
update findings set status = case status when 'answered' then 'rca_review' when 'sent_back' then 'rca_back' else status end;
alter table findings add constraint findings_status_check check (status in ('open','rca_review','rca_back','plan','plan_review','plan_back','accepted','closure_requested','closed','cancelled'));
alter table finding_rounds add column if not exists stage text not null default 'rca' check (stage in ('rca','plan'));
alter table finding_rounds add column if not exists comment text;      -- the NP's note when sending the plan
alter table finding_rounds drop constraint if exists finding_rounds_finding_id_n_key;
alter table finding_rounds add constraint finding_rounds_finding_id_stage_n_key unique (finding_id, stage, n);
alter table findings add column if not exists plan_round int not null default 0;
