-- Chapter tools in the editor: chapters keep a stable id across revisions (links survive renumbering),
-- remember their number in the base revision, and can be deleted (kept as "deleted in Rev N" for What changed / LEP).
alter table revision_sections add column if not exists base_ref text;          -- number in the base revision (null = new chapter)
alter table revision_sections add column if not exists deleted_at timestamptz; -- deleted in this revision (not shown to readers)

-- stable chapter id = same value for the same chapter in every revision of a manual
update revision_sections s set body = jsonb_set(s.body, '{uid}', to_jsonb(md5(r.manual_id::text || ':' || s.ref)))
from revisions r where r.id = s.revision_id and coalesce(s.body->>'uid', '') = '';

-- open drafts: their chapters' numbers in the base revision
update revision_sections s set base_ref = s.ref
from revisions r where r.id = s.revision_id and r.based_on is not null and s.base_ref is null;
