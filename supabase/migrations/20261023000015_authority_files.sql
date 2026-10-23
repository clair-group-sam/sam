-- Projects › Authority files (PRJ-01): one file per application / notification to the authority (TM-CAD, DSAC/METEOR, OSAC).
-- Reference of application types (seeded from the Authority Applications Playbook, 23/10/2026), files, checklist per file,
-- journal (append-only), attachments. Tasks in the Inbox follow the stage of the file.

create table if not exists authority_file_types (
  code text primary key,                   -- OM-APP, MEL, AC-NEW…
  family text not null,                    -- Manuals | Aircraft | People | Airworthiness | Approvals | Reports
  name text not null,
  entities entity_code[] not null default '{}',
  routes jsonb not null default '{}',      -- {"AJD":{"portal":"TM-CAD OPS 4","category":"approval"},"ASJ":{…}}
  checklist jsonb not null default '[]',   -- [{"key":"manual","label":"…","role":"NP","required":true}]
  closeout jsonb not null default '[]',    -- ["Download the approval letter…", …]
  default_owner_role text,                 -- NPFO, NPCT, NPCA, CMM…
  needs_signature boolean not null default false,
  target_days int not null default 20,     -- working days expected at the authority
  ord int not null default 0,
  active boolean not null default true,
  notes text
);

create table if not exists authority_files (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  type_code text not null references authority_file_types(code),
  title text not null,
  stage text not null default 'draft',     -- draft | compliance | signing | ready | submitted | remarks | approved | published | closed | standby
  category text,                           -- approval | notification | declaration | derogation | communication | report
  authority text,                          -- TM-CAD | DSAC | OSAC
  portal text,                             -- "TM-CAD OPS 4", "METEOR NOT #003"…
  portal_ref text,                         -- APP/AJD/OPS_4/38315, METEOR 252776, OSAC SL-102901
  portal_url text,
  owner_role text,                         -- post that prepares the dossier (NPFO…) or PERSON:<uuid>
  owner_person uuid references people(id),
  trigger_kind text,                       -- revision | finding | aircraft | np | regulation | calendar | other
  trigger_note text,
  revision_id uuid references revisions(id),
  finding_ref text,
  aircraft_reg text,
  np_post_code text,
  moc_ref text,                            -- MOC number / folder name on the server
  outcome text,                            -- approved | acknowledged | refused | withdrawn
  rounds int not null default 0,           -- authority remark rounds
  fee numeric, fee_currency text default 'EUR',
  triggered_at date not null default current_date,
  target_date date,
  submitted_at date,
  decision_at date,
  closed_at date,
  lessons text,
  created_by uuid references people(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists authority_files_entity_stage on authority_files (entity, stage);
create index if not exists authority_files_revision on authority_files (revision_id);

create table if not exists authority_file_items (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references authority_files(id) on delete cascade,
  ord int not null default 0,
  key text not null,
  label text not null,
  role text,
  required boolean not null default true,
  done boolean not null default false,
  done_by uuid references people(id),
  done_at timestamptz,
  note text,
  unique (file_id, key)
);

create table if not exists authority_file_events (
  id bigserial primary key,
  file_id uuid not null references authority_files(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null,                      -- created | stage | note | submitted | remarks | reply | decision | attachment | link | task | mail
  who text,
  actor uuid references people(id),
  note text,
  meta jsonb
);
create index if not exists authority_file_events_file on authority_file_events (file_id, at);
revoke update, delete on authority_file_events from public, anon, authenticated;

create table if not exists authority_file_attachments (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references authority_files(id) on delete cascade,
  name text not null,
  kind text,                               -- manual | checklist | form | moc | letter | signed | other
  path text,                               -- evidence/<ENT>/authority/<file>/<name>
  size bigint,
  uploaded_by uuid references people(id),
  at timestamptz not null default now()
);

alter table authority_file_types enable row level security;
alter table authority_files enable row level security;
alter table authority_file_items enable row level security;
alter table authority_file_events enable row level security;
alter table authority_file_attachments enable row level security;
drop policy if exists aft_read on authority_file_types;
create policy aft_read on authority_file_types for select to authenticated using (true);
drop policy if exists af_scope on authority_files;
create policy af_scope on authority_files for select to authenticated using (entity = any(my_entities()));
drop policy if exists afi_scope on authority_file_items;
create policy afi_scope on authority_file_items for select to authenticated using (exists (select 1 from authority_files f where f.id = file_id and f.entity = any(my_entities())));
drop policy if exists afe_scope on authority_file_events;
create policy afe_scope on authority_file_events for select to authenticated using (exists (select 1 from authority_files f where f.id = file_id and f.entity = any(my_entities())));
drop policy if exists afa_scope on authority_file_attachments;
create policy afa_scope on authority_file_attachments for select to authenticated using (exists (select 1 from authority_files f where f.id = file_id and f.entity = any(my_entities())));

-- Seed: the 18 default types (Authority Applications Playbook §7).
insert into authority_file_types (code, family, name, entities, routes, checklist, closeout, default_owner_role, needs_signature, target_days, ord) values
('OM-APP','Manuals','Manual revision requiring prior approval',array['AJD','ASJ','ASF','TEC']::entity_code[],
 '{"AJD":{"portal":"TM-CAD OPS 4","category":"approval"},"ASJ":{"portal":"METEOR APP","category":"approval"},"ASF":{"portal":"METEOR APP #020/#050","category":"approval"},"TEC":{"portal":"OSAC request + Form 2","category":"approval"}}',
 '[{"key":"moc","label":"MOC folder created and numbered; risk assessment when the change touches operations","role":"SM","required":true},
   {"key":"draft","label":"Whole-manual revision: Issue/Rev, revision summary line, every Update-needed page refreshed (cover, TOC, revision summary, LEP last)","role":"NP","required":true},
   {"key":"checklist","label":"Authority compliance checklist of the part updated to the same revision (page 1 revision = manual)","role":"NP","required":true},
   {"key":"residue","label":"No residue of a removed type, no TO FILL, no highlight left; LEP lines = page headers","role":"CMM","required":true},
   {"key":"sign","label":"Signature page NP + CMM (MSM: AM + CMM), effective date set","role":"CMM","required":true},
   {"key":"export","label":"PDF exported without watermark, named <Manual> Ed<X>Rev<Y>.pdf, copied to the MOC folder","role":"CMM","required":true},
   {"key":"form","label":"Portal form text ready (one sentence: object, revision, changes); attachments listed by file name","role":"CMM","required":true}]',
 '["Download the approval letter and the signed manual from the Decision tab","File them under APP - Approvals/<year>/<AAMMJJ> <DOMAIN> - <Manual> EdXRevY","Integrate the signed pages and publish","Deposit on the TM-CAD Operator Documents repository (AJD)","Forward the fee form to Spendesk"]',
 'NPFO', true, 30, 10),
('OM-NOT','Manuals','Manual revision not requiring prior approval',array['AJD','ASJ','ASF','TEC']::entity_code[],
 '{"AJD":{"portal":"TM-CAD OPS 5","category":"notification"},"ASJ":{"portal":"METEOR NOT #003","category":"notification"},"ASF":{"portal":"METEOR NOT #041","category":"notification"},"TEC":{"portal":"OSAC service 118","category":"notification"}}',
 '[{"key":"draft","label":"Revision complete: revision summary line, LEP refreshed","role":"NP","required":true},
   {"key":"route","label":"Compliance confirms no section requires prior approval (ORO.GEN.130 / ORA.GEN.130 / CAO.A.105)","role":"CMM","required":true},
   {"key":"export","label":"PDF exported, named, copied to the MOC folder","role":"CMM","required":true},
   {"key":"form","label":"Description per revised section ready (one element per line)","role":"CMM","required":true}]',
 '["Record the acknowledgement","Publish and send the reading notice","Deposit on the TM-CAD repository (AJD)"]',
 'NPFO', false, 10, 20),
('OM-FND','Manuals','Manual revision for finding closure',array['AJD','ASJ','ASF']::entity_code[],
 '{"AJD":{"portal":"TM-CAD OPS 67","category":"approval"},"ASJ":{"portal":"METEOR APP / NOT","category":"approval"},"ASF":{"portal":"METEOR APP / NOT","category":"approval"}}',
 '[{"key":"finding","label":"Finding number and accepted corrective action plan referenced","role":"CMM","required":true},
   {"key":"draft","label":"Revision complete; changed text quoted in the CAP closure","role":"NP","required":true},
   {"key":"export","label":"PDF exported, named, copied to the MOC folder","role":"CMM","required":true},
   {"key":"form","label":"Form: manual, revision, \"Closure of Findings\", finding number","role":"CMM","required":true}]',
 '["Close the finding in the authority portal and in S.A.M.","Publish and send the reading notice"]',
 'NPFO', true, 20, 30),
('MEL','Manuals','MEL approval / revision (per type)',array['AJD','ASJ','ASF']::entity_code[],
 '{"AJD":{"portal":"TM-CAD OPS 6","category":"approval"},"ASJ":{"portal":"METEOR APP MEL (ORO.MLR.105)","category":"approval"},"ASF":{"portal":"METEOR #068 / #069","category":"approval"}}',
 '[{"key":"mmel","label":"MMEL revision copy and highlights attached; every MMEL item accounted for (items check)","role":"NP","required":true},
   {"key":"mel","label":"MEL signed NPFO + CMM; repair intervals and rectification categories consistent with OM-A","role":"NP","required":true},
   {"key":"rie","label":"RIE table, DDG / O&M appendix, AD/CF references when applicable","role":"CAMO","required":false},
   {"key":"attest","label":"MEL conformity attestation (DSAC)","role":"CMM","required":false},
   {"key":"form","label":"Key = OM-B.09 MEL <type> Ed01 Rev0N; attachments listed","role":"CMM","required":true}]',
 '["Download the stamped MEL and the letter","Integrate and publish","Repository deposit (AJD)"]',
 'NPFO', true, 30, 40),
('AC-NEW','Aircraft','Aircraft addition — new type (project)',array['AJD','ASJ']::entity_code[],
 '{"AJD":{"portal":"TM-CAD OPS 9 + AW01 set","category":"approval"},"ASJ":{"portal":"METEOR APP fleet + OpSpecs","category":"approval"}}',
 '[{"key":"contract","label":"LOI / management contract signed; PPI; manufacturer documentation access (evidence)","role":"AM","required":true},
   {"key":"cmpa","label":"CMPA check and list of specific approvals (RVSM, LVTO, NAT HLA, steep approach)","role":"CMM","required":true},
   {"key":"forms","label":"AOC variation form, OM approval form, EASA Form 2, insurance","role":"CMM","required":true},
   {"key":"camo","label":"Part-CAMO variation dossier (Form 2, checklist, MOC/RA, manhour plan, audit plan, proof of access, e-ATL, dent & buckle)","role":"CAMO","required":true},
   {"key":"came","label":"CAME revision (separate application)","role":"CAMO","required":true},
   {"key":"amp","label":"AMP initial issue + TCH source documents","role":"CAMO","required":true},
   {"key":"reg","label":"Registration, CofA, radio licence, ARC","role":"CAMO","required":true},
   {"key":"om","label":"OM-A/B/C/D, MEL, EFB manual, Security manual, MSM revised with the type + authority checklists per part","role":"NP","required":true},
   {"key":"fstd","label":"FSTD application (CAD225, qualification certificate, LSA)","role":"NPCT","required":true},
   {"key":"crew","label":"Crew licences, medicals, SPA training; FDM agreement; OFP + ATC FPL samples","role":"NPCT","required":true},
   {"key":"omd","label":"OM-D submitted first so simulator training can start","role":"CMM","required":false}]',
 '["OpSpecs, Part-CAMO certificate, CAME/AMP approval pages, MEL stamp received","Publish all manuals","Repository deposit","Close the project"]',
 'CMM', true, 90, 50),
('AC-SAME','Aircraft','Aircraft addition — same type / new registration',array['AJD','ASJ','ASF']::entity_code[],
 '{"AJD":{"portal":"TM-CAD Addition of aircraft (Same Type) + AW01","category":"approval"},"ASJ":{"portal":"METEOR APP fleet list","category":"approval"},"ASF":{"portal":"METEOR #026 aircraft list","category":"approval"}}',
 '[{"key":"reg","label":"Registration certificate, CofA, ARC, noise, radio licence","role":"CAMO","required":true},
   {"key":"ins","label":"Insurance certificate","role":"NPGO","required":true},
   {"key":"amp","label":"AMP update (MSN added) and CAME fleet list if applicable","role":"CAMO","required":true},
   {"key":"wb","label":"OM-B W&B appendix / loading data for the registration","role":"NPFO","required":true},
   {"key":"ops","label":"OpSpecs page draft, SPA per registration","role":"CMM","required":true}]',
 '["OpSpecs received","Fleet registry updated in S.A.M.","Certificates filed"]',
 'NPGO', false, 30, 60),
('AC-OUT','Aircraft','Aircraft removal',array['AJD','ASJ','ASF']::entity_code[],
 '{"AJD":{"portal":"TM-CAD OPS 10","category":"approval"},"ASJ":{"portal":"METEOR sortie de liste de flotte","category":"approval"},"ASF":{"portal":"METEOR #026","category":"notification"}}',
 '[{"key":"ops","label":"OpSpecs page, fleet list, OM-B part if last of type","role":"CMM","required":true},
   {"key":"camo","label":"CAME / AMP update, deregistration","role":"CAMO","required":true},
   {"key":"ins","label":"Insurance cancellation","role":"NPGO","required":true}]',
 '["New OpSpecs received","Fleet registry updated"]',
 'CMM', false, 20, 70),
('NCC','Aircraft','NCC declaration / NCC OM',array['AJD']::entity_code[],
 '{"AJD":{"portal":"TM-CAD NCC Declaration (CAD 289)","category":"declaration"}}',
 '[{"key":"decl","label":"CAD 289 declaration form signed by the AM","role":"AM","required":true},
   {"key":"om","label":"NCC OM-A/B/C/D, MSM, Security manual","role":"NPFO","required":true},
   {"key":"xlist","label":"Part-NCC compliance checklist + statement; NCC.IDE checklist","role":"CMM","required":true},
   {"key":"mel","label":"MEL (separate OPS 6 application)","role":"NPFO","required":true}]',
 '["Acknowledgement of the declaration and NCC OpSpecs received","Publish the NCC manuals"]',
 'NPFO', true, 15, 80),
('NP','People','Nominated person / deputy acceptance',array['AJD','ASJ','ASF','TEC']::entity_code[],
 '{"AJD":{"portal":"TM-CAD Acceptance of NPs (Form 4)","category":"approval"},"ASJ":{"portal":"METEOR APP Form 4 DSAC","category":"approval"},"ASF":{"portal":"METEOR #011–#015","category":"approval"},"TEC":{"portal":"OSAC Form 4 + Form 2","category":"approval"}}',
 '[{"key":"form4","label":"Form 4 signed by the AM","role":"AM","required":true},
   {"key":"cv","label":"CV, licence, medical, training records; experience matches the AMC thresholds","role":"NP","required":true},
   {"key":"chart","label":"OM-A A.01 organisation chart revised (deputy box drawn); MSM and Form 4 dates coherent","role":"CMM","required":true},
   {"key":"comp","label":"Competency assessment record (ENR-COMP)","role":"CMM","required":true},
   {"key":"moc","label":"MOC for the change of post holder","role":"SM","required":true}]',
 '["Acceptance letter filed","NP management record set to accepted","OM-A revision published"]',
 'CMM', true, 30, 90),
('CAME','Airworthiness','CAME / CAE revision',array['AJD','TEC']::entity_code[],
 '{"AJD":{"portal":"TM-CAD AW01 Review / Approval of CAME","category":"approval"},"TEC":{"portal":"OSAC request (CAO.A.105)","category":"approval"}}',
 '[{"key":"amend","label":"§ 00.4 list of amendments complete; no residue of removed types","role":"CAMO","required":true},
   {"key":"link","label":"Linked Part-CAMO / AMP application number quoted in the comment","role":"CMM","required":false},
   {"key":"export","label":"PDF exported, named AJD-CAMO-CAME Ed<X>Rev<Y>","role":"CMM","required":true}]',
 '["Approval page + stamped LEP integrated","Publish","Repository deposit"]',
 'NPCA', true, 20, 100),
('AMP','Airworthiness','AMP revision / initial issue / task extension',array['AJD','ASJ']::entity_code[],
 '{"AJD":{"portal":"TM-CAD AW01 Review / Approval of AMP","category":"approval"},"ASJ":{"portal":"OSAC (F-registered under MT.CAMO.0079)","category":"approval"}}',
 '[{"key":"tch","label":"Every TCH revision cited by issue and date; highlights / record of changes attached","role":"CAMO","required":true},
   {"key":"amp","label":"AMP with effective date, approval pages left blank for the stamp","role":"CAMO","required":true},
   {"key":"form","label":"Key = AJD-CAMO-AMP<TYPE> update to Ed<X> Rev <Y>; attachments listed","role":"CMM","required":true}]',
 '["Consolidate the stamped pages and upload to the application and the repository (TM-CAD action)","Publish"]',
 'NPCA', false, 15, 110),
('CAMO-VAR','Airworthiness','Part-CAMO / Part-CAO approval or variation',array['AJD','TEC']::entity_code[],
 '{"AJD":{"portal":"TM-CAD AW01 Approval / Variation of Part-CAMO","category":"approval"},"TEC":{"portal":"OSAC Form 2","category":"approval"}}',
 '[{"key":"form2","label":"EASA Form 2 signed by the AM","role":"AM","required":true},
   {"key":"xlist","label":"Part-CAMO compliance checklist (TM/CAD/0384) customised","role":"CAMO","required":true},
   {"key":"moc","label":"MOC + risk assessment","role":"SM","required":true},
   {"key":"plans","label":"Manhour plan AJD-CAMO-14, audit plan ENR-M-01","role":"CAMO","required":true},
   {"key":"access","label":"Proof of access to manufacturer documentation; e-ATL screenshot; dent & buckle chart","role":"CAMO","required":true},
   {"key":"came","label":"CAME submitted as a separate application","role":"CMM","required":true}]',
 '["New Part-CAMO certificate / scope received and filed","CAME and AMP published"]',
 'NPCA', true, 40, 120),
('AW-CERT','Airworthiness','Registration, CofA, ARC, noise, radio, ELT, Form 14, permit to fly',array['AJD']::entity_code[],
 '{"AJD":{"portal":"TM-CAD AW01 (per certificate type)","category":"approval"}}',
 '[{"key":"form","label":"Certificate application form and supporting documents per TM-CAD AW forms list","role":"CAMO","required":true}]',
 '["Certificate filed in Certificates & Validities with its expiry"]',
 'NPCA', false, 10, 130),
('FSTD','Approvals','FSTD use approval / simulator change',array['AJD','ASJ','ASF']::entity_code[],
 '{"AJD":{"portal":"TM-CAD OPS 28 (CAD225)","category":"approval"},"ASJ":{"portal":"METEOR APP FSTD","category":"approval"},"ASF":{"portal":"METEOR #021","category":"approval"}}',
 '[{"key":"cert","label":"FSTD qualification certificate and the training organisation approval","role":"NPCT","required":true},
   {"key":"lsa","label":"Agreement / LSA with the FSTD operator","role":"NPCT","required":true},
   {"key":"omd","label":"OM-D section updated (device, programme)","role":"NPCT","required":true}]',
 '["Approval received and OM-D published"]',
 'NPCT', false, 20, 140),
('SPA','Approvals','Specific approval (RVSM, LVO, PBN, steep approach, EFB, DGR, alleviation, SPO)',array['AJD','ASJ','ASF']::entity_code[],
 '{"AJD":{"portal":"TM-CAD CAD177 / CAD99 / CAD 166 / alleviation","category":"approval"},"ASJ":{"portal":"METEOR APP SPA","category":"approval"},"ASF":{"portal":"METEOR #050","category":"approval"}}',
 '[{"key":"ra","label":"Risk assessment","role":"SM","required":true},
   {"key":"proc","label":"OM-A/B procedure, AFM / OSD reference","role":"NPFO","required":true},
   {"key":"train","label":"Crew training programme and records","role":"NPCT","required":true},
   {"key":"form","label":"Authority form for the approval; one approval per application","role":"CMM","required":true}]',
 '["OpSpecs updated","Manuals published"]',
 'NPFO', false, 30, 150),
('TRAIN','Approvals','Training programme / course approval',array['ASJ','ASF']::entity_code[],
 '{"ASJ":{"portal":"METEOR APP programme (ORO.FC)","category":"approval"},"ASF":{"portal":"METEOR #020","category":"approval"}}',
 '[{"key":"prog","label":"Programme as a standalone document + OM-D / TM revision","role":"NPCT","required":true},
   {"key":"impact","label":"Impact study / MOC and compliance matrix against the AMC","role":"CMM","required":true},
   {"key":"instr","label":"Instructor qualifications; FSTD certificate when a device is used","role":"NPCT","required":true}]',
 '["Approval received","Programme published, FlightLogger / training records updated"]',
 'NPCT', false, 30, 160),
('DER','Approvals','Derogation / exemption and renewal',array['ASJ','ASF']::entity_code[],
 '{"ASJ":{"portal":"METEOR DER","category":"derogation"},"ASF":{"portal":"METEOR DER","category":"derogation"}}',
 '[{"key":"letter","label":"Request letter with the previous derogation reference","role":"CMM","required":true},
   {"key":"ra","label":"Risk assessment and mitigation","role":"SM","required":true}]',
 '["Derogation filed with its expiry; renewal task at D-60"]',
 'CMM', false, 40, 170),
('REPORT','Reports','Periodic / event report or notification',array['AJD','ASJ']::entity_code[],
 '{"AJD":{"portal":"TM-CAD quarterly mandatory report / FDP exceedances / conflict zone / non-commercial flight","category":"report"},"ASJ":{"portal":"METEOR CEO (RIE/RTS, FTL exceedance)","category":"communication"}}',
 '[{"key":"report","label":"Report PDF prepared and checked","role":"CMM","required":true}]',
 '["Acknowledgement recorded"]',
 'CMM', false, 10, 180)
on conflict (code) do nothing;
