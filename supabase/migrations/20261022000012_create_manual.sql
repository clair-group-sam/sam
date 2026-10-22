-- Creating a manual from the library (CMM, AM, NPs, their deputies, and people Compliance names), internal documents
-- published by their author after a review by the assistant.
alter table people add column if not exists can_create_manuals boolean not null default false;
alter table manuals add column if not exists internal boolean not null default false;   -- no authority approval / notification
alter table manuals add column if not exists created_by uuid references people(id);
alter table manuals add column if not exists owner_name text;                           -- when the owner is a named person (owner_role = 'PERSON:<id>')
alter table revisions add column if not exists review jsonb;                            -- assistant review before an internal publication (not part of the journal)
