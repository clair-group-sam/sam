-- REG-03 · Articles of the Easy Access Rules (06/11). Loaded from the EASA XML export of each EAR version: one row per rule (IR), AMC, GM or CS,
-- with its source and structured text. The audit shows the official text of the current version; a new version is compared article by article.

create table if not exists regulation_items (
  id uuid primary key default gen_random_uuid(),
  regulation_id uuid not null references regulations(id) on delete cascade,
  version text not null,                               -- the EAR version the text comes from (regulations.current_version at load time)
  ref text not null,                                   -- full heading key: "ORO.GEN.200" · "AMC1 ORO.GEN.200(a)(1)" · "GM2 ORO.GEN.200(a)(3)"
  kind text not null check (kind in ('ir','amc','gm','cs','other')),
  code text not null,                                  -- the rule the item belongs to: ORO.GEN.200 (same as ref for an IR)
  title text,                                          -- Management system
  source text,                                         -- Regulation (EU) No 965/2012 · ED Decision 2025/020/R
  annex text,                                          -- ANNEX III (Part-ORO)
  section text,                                        -- SUBPART GEN · SECTION 2 – Management
  body jsonb not null default '[]',                    -- [{"l":0,"t":"(a) The operator shall…"}, …]  (l = indent level, headings as l:-1)
  body_text text,                                      -- flat text for search
  hash text not null,                                  -- sha1 of title + body, to compare versions
  ord int not null default 0,
  change text check (change in ('new','modified','unchanged','removed')),   -- against the previous loaded version
  unique (regulation_id, version, ref)
);
create index if not exists regulation_items_lookup on regulation_items (regulation_id, version, code);
create index if not exists regulation_items_code on regulation_items (code);
alter table regulation_items enable row level security;
drop policy if exists regulation_items_read on regulation_items;
create policy regulation_items_read on regulation_items for select using (true);

alter table regulations add column if not exists items_version text;     -- the version whose articles are loaded
alter table regulations add column if not exists items_count int;
alter table regulations add column if not exists items_loaded_at timestamptz;
alter table regulations add column if not exists items_note text;
