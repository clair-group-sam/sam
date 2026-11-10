-- 10/11 · MSM (Guillaume): an observation is answered within 6 months of its notification. Default due date when none is given.
create or replace function finding_obs_due() returns trigger language plpgsql as $$
begin
  if new.level = 'obs' and new.due is null and new.notified is not null then
    new.due := (new.notified + interval '6 months')::date;
  end if;
  return new;
end $$;
drop trigger if exists finding_obs_due on findings;
create trigger finding_obs_due before insert or update of level, notified, due on findings for each row execute function finding_obs_due();
update findings set due = (notified + interval '6 months')::date where level = 'obs' and due is null and notified is not null;
