-- SAF-07 (meeting 29/10): Astonfly reports stay in FlightLogger; S.A.M. retrieves them for analysis and treatment.
-- history = imported as a past record (mirrored as it is in the source: sent / not sent to ECCAIRS, no clock);
-- a report retrieved from FlightLogger after the switch is NOT history: it is treated in S.A.M. like any report (72 h clock from its receipt in FlightLogger).
alter table reports add column if not exists history boolean not null default false;
alter table reports add column if not exists source_status text;   -- the status shown in the source tool (FlightLogger: Open / Level 1 / Level 2 / Closed), mirrored at each sync
alter table reports add column if not exists synced_at timestamptz; -- last time the source was read
update reports set history = true where source <> 'sam' and history = false;
create index if not exists reports_source_idx on reports (source, external_no);
