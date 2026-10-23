-- Version 16 is already recorded on sam-dev (it was used twice: authority rounds and drop documents).
-- This file keeps the local history in step with the database. Its content is idempotent and is repeated by 17 and 19,
-- so on a fresh database (sam-prod) running it changes nothing harmful.

alter table certificates add column if not exists reference text;          -- certificate / policy / approval number
alter table certificates add column if not exists issued_on date;
alter table certificates add column if not exists summary text;
alter table certificates add column if not exists uploaded_by uuid references people(id);
alter table certificates add column if not exists uploaded_at timestamptz;
alter table certificates add column if not exists replaced_by uuid references certificates(id);
alter table certificates add column if not exists archived_at timestamptz; -- superseded by a newer document (kept for the record)
alter table certificates add column if not exists alerts jsonb not null default '{}'; -- {"90":"2026-10-24","30":…,"7":…,"expired":…}
create index if not exists certificates_valid on certificates (valid_until) where archived_at is null;
