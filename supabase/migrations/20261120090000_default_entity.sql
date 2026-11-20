-- IAM-03 · the entity a person lands on (20/11): chosen by the person in the user menu when they work in several entities.
-- An entity code of their scope, or 'ALL' (every entity of their scope: "Group" for a group function, "ALL" otherwise). Empty: home entity.
alter table people add column if not exists default_entity text;
