-- SAF-09 · history of the safety promotion: bulletins already published in Web Manuals (Astonfly › 5.MEETING › FLIGHT SAFETY REPORT —
-- monthly Flight Safety Reports and "ENVOL" safety bulletins), imported read-only: the PDF is the record, nothing is sent again.
alter table safety_promotions add column if not exists source text not null default 'sam';
alter table safety_promotions add column if not exists source_ref text;      -- Web Manuals document id
alter table safety_promotions add column if not exists pdf_path text;        -- storage: promotions/<ENT>/<number>.pdf
alter table safety_promotions add column if not exists issued_on date;       -- the month the bulletin is dated (from its name)
create unique index if not exists safety_promotions_source on safety_promotions (source, source_ref) where source_ref is not null;
insert into storage.buckets (id, name, public, file_size_limit) values ('promotions', 'promotions', false, 52428800) on conflict (id) do nothing;
