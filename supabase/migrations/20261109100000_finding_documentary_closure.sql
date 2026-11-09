-- FND-04 (09/11) · Documentary closure (FDGSC2602): a finding whose corrective action is a manual change is closed on the date of
-- the authority's approval / acknowledgement (submitted manuals) or of the publication (other documents) — never when the text
-- is written. The manual change is an intermediate step, traced as such. The list shows how far each finding's work has gone.

alter table finding_changes drop constraint if exists finding_changes_status_check;
alter table finding_changes add constraint finding_changes_status_check
  check (status in ('pending','included','deferred','awaiting_authority','published','verified','removed'));
alter table finding_changes add column if not exists route text;                 -- approval | notification | publication (what makes it effective)
alter table finding_changes add column if not exists authority_file_id uuid references authority_files(id) on delete set null;
alter table finding_changes add column if not exists authority_ref text;         -- METEOR dossier / TM-CAD application reference
alter table finding_changes add column if not exists effective_on date;          -- decision / acknowledgement date, or publication date
alter table findings add column if not exists effective_closed_on date;          -- regulatory closure date = last effective_on of the plan

-- a revision published → the changes it includes are 'published' (route none) or wait for the authority's return when the
-- revision goes through an approval / notification and no decision is recorded yet
create or replace function finding_change_follow_revision() returns trigger language plpgsql as $$
declare af record;
begin
  if new.step in ('published','repository') and (old.step is distinct from new.step) then
    select id, portal_ref, outcome, decision_at into af from authority_files
      where revision_id = new.id and outcome in ('approved','acknowledged') order by decision_at desc nulls last limit 1;
    if new.authority_route in ('approval','notification') and af.id is null then
      update finding_changes set status = 'awaiting_authority', route = new.authority_route
        where revision_id = new.id and status in ('included','awaiting_authority');
    else
      update finding_changes set status = 'published',
        route = coalesce(nullif(new.authority_route, 'none'), 'publication'),
        authority_file_id = coalesce(authority_file_id, af.id),
        authority_ref = coalesce(authority_ref, af.portal_ref, new.authority_ref),
        effective_on = coalesce(af.decision_at, new.published_at, current_date)
        where revision_id = new.id and status in ('included','awaiting_authority');
    end if;
  end if;
  return new;
end $$;

-- the authority approves / acknowledges → the changes waiting on that revision become 'published', dated at the decision
create or replace function finding_change_follow_authority() returns trigger language plpgsql as $$
begin
  if new.outcome in ('approved','acknowledged') and (old.outcome is distinct from new.outcome) and new.revision_id is not null then
    update finding_changes set status = 'published', route = coalesce(route, new.category, 'approval'),
      authority_file_id = new.id, authority_ref = coalesce(new.portal_ref, authority_ref), effective_on = coalesce(new.decision_at, current_date)
      where revision_id = new.revision_id and status in ('awaiting_authority','included');
  end if;
  return new;
end $$;
drop trigger if exists finding_change_follow_authority on authority_files;
create trigger finding_change_follow_authority after update of outcome on authority_files for each row execute function finding_change_follow_authority();
