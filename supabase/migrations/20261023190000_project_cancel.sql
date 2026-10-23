-- Projects: "cancelled" status (super admin only, from the list); a cancelled project keeps its history, a deleted one is gone.
alter table projects drop constraint if exists projects_status_check;
alter table projects add constraint projects_status_check check (status in ('open','on_hold','closed','cancelled'));
