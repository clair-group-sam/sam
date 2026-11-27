-- SAF (27/11) · a top hazard is designated on the hazard itself. The "Top risk" mark of an entry comes from Centrik, where one entry
-- can hold the whole register (135 hazards on Astonjet Ltd): on the entry it designates nothing. Who designated it and when are kept.
alter table hazards add column if not exists top_risk boolean not null default false;
alter table hazards add column if not exists top_risk_at timestamptz;
alter table hazards add column if not exists top_risk_by uuid references people(id) on delete set null;
alter table hazards add column if not exists top_risk_note text;
