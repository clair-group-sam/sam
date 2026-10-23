-- Safety net: 20261023000016 was used twice (authority_rounds_file and drop_documents, now 17). Replays the authority-rounds
-- migration, written idempotently, so it is applied whichever of the two the database recorded as version 16.

-- PRJ-01 ↔ DOC-09: the exchange rounds with the authority belong to the authority file as well as to the manual revision.
-- A file without a manual (aircraft, NP, report…) can now have rounds of its own; rounds written from the revision editor
-- are attached to the open file of that revision automatically.

alter table authority_rounds add column if not exists file_id uuid references authority_files(id) on delete set null;
alter table authority_rounds alter column revision_id drop not null;
alter table authority_rounds drop constraint if exists authority_rounds_subject;
alter table authority_rounds add constraint authority_rounds_subject check (revision_id is not null or file_id is not null);
create index if not exists authority_rounds_file on authority_rounds (file_id, at);
create index if not exists authority_rounds_revision on authority_rounds (revision_id, at);

-- rounds recorded with a revision only: attach them to the open (or latest) file of that revision
create or replace function authority_round_attach() returns trigger language plpgsql as $$
begin
  if new.file_id is null and new.revision_id is not null then
    select f.id into new.file_id from authority_files f where f.revision_id = new.revision_id
      order by (f.stage not in ('closed','standby')) desc, f.created_at desc limit 1;
  end if;
  if new.revision_id is null and new.file_id is not null then
    select f.revision_id into new.revision_id from authority_files f where f.id = new.file_id;
  end if;
  return new;
end $$;
drop trigger if exists authority_round_attach_trg on authority_rounds;
create trigger authority_round_attach_trg before insert on authority_rounds for each row execute function authority_round_attach();

-- backfill existing rounds
update authority_rounds r set file_id = (
  select f.id from authority_files f where f.revision_id = r.revision_id
  order by (f.stage not in ('closed','standby')) desc, f.created_at desc limit 1)
where r.file_id is null and r.revision_id is not null;

-- people in scope of the file may read its rounds (Compliance keeps full read through the existing policy)
drop policy if exists rounds_file_scope on authority_rounds;
create policy rounds_file_scope on authority_rounds for select to authenticated
  using (exists (select 1 from authority_files f where f.id = file_id and f.entity = any(my_entities())));
