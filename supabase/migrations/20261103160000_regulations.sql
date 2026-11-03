-- REG-02 · Regulation module (03/11): the Easy Access Rules (EASA) and other texts we use, always in their latest version,
-- linked to the regulatory watch. A new revision found on the EASA page becomes the current version and raises a watch entry "to analyse"
-- for each entity concerned. Previous versions stay listed.

create table if not exists regulations (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,                            -- air-operations, aircrew…
  kind text not null default 'ear' check (kind in ('ear','other')),
  title text not null,                                 -- Easy Access Rules for Air Operations
  short text not null,                                 -- Air Operations
  number text,                                         -- Regulation (EU) No 965/2012
  page_url text not null,                              -- EASA EAR page (or EUR-Lex for 'other')
  pdf_url text, online_url text, xml_url text,
  entities text[] not null default '{}',
  domains text[] not null default '{}',
  current_version text,                                -- Revision 24, March 2026
  version_since date,                                  -- when S.A.M. first saw this version
  checked_at timestamptz,
  check_result text,                                   -- ok | changed | unreachable | manual
  check_note text,
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table regulations enable row level security;
drop policy if exists regulations_read on regulations;
create policy regulations_read on regulations for select using (true);

create table if not exists regulation_versions (
  id uuid primary key default gen_random_uuid(),
  regulation_id uuid not null references regulations(id) on delete cascade,
  version text not null,
  seen_on date not null default current_date,
  pdf_url text, online_url text, xml_url text,
  watch_entry_ids uuid[] not null default '{}',
  recorded_by uuid references people(id) on delete set null, -- null = S.A.M.'s check
  unique (regulation_id, version)
);
alter table regulation_versions enable row level security;
drop policy if exists regulation_versions_read on regulation_versions;
create policy regulation_versions_read on regulation_versions for select using (true);

alter table watch_entries add column if not exists regulation_id uuid references regulations(id) on delete set null;

insert into regulations (key, kind, title, short, number, page_url, pdf_url, online_url, xml_url, entities, domains, sort) values
 ('air-operations','ear','Easy Access Rules for Air Operations','Air Operations','Regulation (EU) No 965/2012',
  'https://www.easa.europa.eu/en/document-library/easy-access-rules/easy-access-rules-air-operations','https://www.easa.europa.eu/en/downloads/20342/en',
  'https://www.easa.europa.eu/en/document-library/easy-access-rules/online-publications/easy-access-rules-air-operations','https://www.easa.europa.eu/en/downloads/136682/en',
  '{ASJMT,ASJFR,ASFFR}','{OPS,ATO}',10),
 ('aircrew','ear','Easy Access Rules for Aircrew','Aircrew','Regulation (EU) No 1178/2011',
  'https://www.easa.europa.eu/en/document-library/easy-access-rules/easy-access-rules-aircrew','https://www.easa.europa.eu/en/downloads/115485/en',null,'https://www.easa.europa.eu/en/downloads/136679/en',
  '{ASFFR,ASJMT,ASJFR}','{ATO,FSTD,OPS}',20),
 ('aeroplane-fstd','ear','Easy Access Rules for Aeroplane Flight Simulation Training Devices (CS-FSTD(A))','CS-FSTD(A)','CS-FSTD(A)',
  'https://www.easa.europa.eu/en/document-library/easy-access-rules/easy-access-rules-aeroplane-flight-simulation-training-devices',null,null,null,
  '{ASFFR}','{FSTD}',25),
 ('continuing-airworthiness','ear','Easy Access Rules for Continuing Airworthiness','Continuing Airworthiness','Regulation (EU) No 1321/2014',
  'https://www.easa.europa.eu/en/document-library/easy-access-rules/easy-access-rules-continuing-airworthiness','https://www.easa.europa.eu/en/downloads/95788/en',null,'https://www.easa.europa.eu/en/downloads/136699/en',
  '{ASJMT,ASTFR}','{CAMO,CAE}',30),
 ('basic-regulation','ear','Easy Access Rules for the Basic Regulation','Basic Regulation','Regulation (EU) 2018/1139',
  'https://www.easa.europa.eu/en/document-library/easy-access-rules/easy-access-rules-basic-regulation-regulation-eu-20181139','https://www.easa.europa.eu/en/downloads/107247/en',null,'https://www.easa.europa.eu/en/downloads/136659/en',
  '{ASJMT,ASJFR,ASFFR,ASTFR}','{}',40),
 ('information-security','ear','Easy Access Rules for Information Security (Part-IS)','Information Security (Part-IS)','Regulations (EU) 2023/203 and 2022/1645',
  'https://www.easa.europa.eu/en/document-library/easy-access-rules/easy-access-rules-information-security-regulations-eu-2023203-and-20221645','https://www.easa.europa.eu/en/downloads/138788/en',null,'https://www.easa.europa.eu/en/downloads/138790/en',
  '{ASJMT,ASJFR,ASFFR,ASTFR}','{IS}',50),
 ('occurrence-reporting','other','Occurrence reporting in civil aviation','Occurrence reporting','Regulation (EU) No 376/2014',
  'https://eur-lex.europa.eu/eli/reg/2014/376/oj',null,null,null,
  '{ASJMT,ASJFR,ASFFR,ASTFR}','{SAFETY}',60)
on conflict (key) do nothing;
