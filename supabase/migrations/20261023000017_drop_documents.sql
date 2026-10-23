-- Drop a document (insurance, approval, aircraft document…): SAM reads it and proposes where it goes; validity alerts 90 / 30 / 7 days.
alter table certificates add column if not exists reference text;          -- certificate / policy / approval number
alter table certificates add column if not exists issued_on date;
alter table certificates add column if not exists summary text;
alter table certificates add column if not exists uploaded_by uuid references people(id);
alter table certificates add column if not exists uploaded_at timestamptz;
alter table certificates add column if not exists replaced_by uuid references certificates(id);
alter table certificates add column if not exists archived_at timestamptz; -- superseded by a newer document (kept for the record)
alter table certificates add column if not exists alerts jsonb not null default '{}'; -- {"90":"2026-10-24","30":…,"7":…,"expired":…}
create index if not exists certificates_valid on certificates (valid_until) where archived_at is null;
