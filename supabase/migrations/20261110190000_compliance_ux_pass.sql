-- 10/11 · Compliance UX pass (Guillaume): external auditors in the register, finding type, imported analyses.

-- Internal auditors: an auditor named in an audit may not be staff (L. Rudelle, TTF…) → a register line without a person.
alter table auditors alter column person_id drop not null;
alter table auditors add column if not exists name text;                       -- external auditor's name when no person
alter table auditors add column if not exists aliases text[] not null default '{}'; -- how audits write them (initials, company…)
do $$ begin
  alter table auditors add constraint auditors_person_or_name check (person_id is not null or name is not null);
exception when duplicate_object then null; end $$;
update auditors a set aliases = array['GFE','G. Fournié','G. Fournie']
  from people p where p.id = a.person_id and p.display_name ilike 'Guillaume Fourni%' and not ('GFE' = any(a.aliases));

-- Findings: the type of non-compliance (documentary, procedure, training…), proposed by S.A.M., changed by the user.
alter table findings add column if not exists finding_type text;
alter table findings add column if not exists finding_type_by text check (finding_type_by in ('sam','user'));

-- Findings imported from Monday with their root cause and plan: the analysis is done, the plan is running → accepted, analysis kept as round 1.
update findings f set
  draft_root_cause = coalesce(f.draft_root_cause, nullif(trim(substring(f.description from 'Root cause \(Monday\): (.*?)(\n\nCorrective action plan \(Monday\):|\n\nExtension:|$)')), '')),
  draft_comment    = coalesce(f.draft_comment,    nullif(trim(substring(f.description from 'Corrective action plan \(Monday\): (.*?)(\n\nExtension:|$)')), ''))
where f.imported_from like 'Monday Compliance Software%' and f.description like '%Root cause (Monday):%';

insert into finding_rounds (finding_id, stage, n, root_cause, comment, answered_at, via, decision, decided_at, note)
select f.id, 'full', 1, f.draft_root_cause, f.draft_comment, coalesce(f.notified::timestamptz, now()), 'import', 'accepted', coalesce(f.notified::timestamptz, now()), 'Analysis and plan imported from Monday (Compliance Software)'
from findings f
where f.imported_from like 'Monday Compliance Software%' and f.status in ('open','closed') and f.draft_root_cause is not null
  and not exists (select 1 from finding_rounds r where r.finding_id = f.id);

update findings f set current_round = 1, plan_round = 1, draft_step = 3,
  status = case when f.status = 'open' and f.draft_comment is not null then 'accepted' else f.status end
where f.imported_from like 'Monday Compliance Software%' and f.draft_root_cause is not null and f.current_round = 0;

-- the text of the finding keeps the auditor's words only; the Monday root cause / plan now live in the analysis (round 1)
update findings f set description = split_part(f.description, E'\n\nRoot cause (Monday):', 1) || coalesce(E'\n\n' || substring(f.description from '(Extension: .*)$'), '')
where f.imported_from like 'Monday Compliance Software%' and f.description like '%Root cause (Monday):%' and f.draft_root_cause is not null;
