-- Parallel revisions: a draft can be based on a revision still under review; its changed chapters are frozen until publication.
alter table revisions add column if not exists based_on uuid references revisions(id);
alter table revision_sections add column if not exists conflict jsonb;   -- {base_html, base_rev, at} when both revisions changed the chapter
create index if not exists revisions_based_on_idx on revisions(based_on);
