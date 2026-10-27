-- Hazard log / MOC / RA split (ICAO Doc 9859, ORO.GEN.200): the hazard log holds each lasting hazard once with its current rating;
-- MOC and one-off RA are dated studies whose hazards either link to a hazard of the log or stay local (temporary).
alter table hazards add column if not exists log_hazard_id uuid references hazards(id) on delete set null;
alter table hazards add column if not exists local_only boolean not null default false;
create index if not exists hazards_log_hazard_idx on hazards(log_hazard_id);

-- SAM (AI) suggestions: study hazard -> log hazards, safety report -> log hazards, log hazard -> possible duplicates in the log
create table if not exists risk_matches (
  subject_kind text not null check (subject_kind in ('hazard','report','duplicate')),
  subject_id text not null,
  entity text not null,
  suggestions jsonb not null default '[]'::jsonb,
  ran_at timestamptz not null default now(),
  primary key (subject_kind, subject_id)
);
alter table risk_matches enable row level security;
