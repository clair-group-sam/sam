-- Safety reports history imported from Centrik (AJD / ASJ "Safety" subsystems) and later FlightLogger (ASF): the record as it was closed there.
alter table reports add column if not exists source text not null default 'sam';
alter table reports add column if not exists source_ref text;           -- Centrik CaseId
alter table reports add column if not exists external_no text;          -- Centrik number (000213)
alter table reports add column if not exists report_type text;          -- ASR, GSR, FDM, DGR, ESR, FAT, DEX, HAZ…
alter table reports add column if not exists reporter_name text;        -- imported reports only — shown to the safety desk only, like reporter_person
alter table reports add column if not exists source_erc int;            -- the score given in the source tool (Centrik matrix), kept as recorded
alter table reports add column if not exists occurrence_class text;     -- accident / serious incident / incident / occurrence…
alter table reports add column if not exists risk_category text;        -- Centrik risk category → sub-category
alter table reports add column if not exists event_type text;           -- ECCAIRS event type path
alter table reports add column if not exists investigation text;        -- details of the investigation
alter table reports add column if not exists findings text;             -- findings and observations
alter table reports add column if not exists closed_by_name text;
alter table reports add column if not exists hazard_label text;         -- the risk register link as written in the source
create unique index if not exists reports_source on reports (source, source_ref) where source_ref is not null;
