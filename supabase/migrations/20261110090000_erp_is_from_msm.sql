-- ERP and Part-IS built from the MSMs and the "Cartographie Part-IS" (10/11/2026).
-- ERP: one plan per entity read from its MSM (AJD MSM Iss 01 Rev 09 ch. 9, ASJ MSM Iss 10 Rev 07 ch. 8, ASF MSM Iss 10 Rev 01 ch. 6),
-- the response cell by scenario, timed milestones, the MSM checklists, the crisis directory (ENR-CM-15) and a primary information
-- sheet captured at activation. Personal mobile numbers and e-mails are NOT seeded (public repository): they are entered once
-- in the Crisis directory.
-- Part-IS: the systems register gets the cartography fields (department, zone, responsibility, contract, operational impact,
-- attention level, status, source) and is seeded with the 35 systems and 4 departments awaiting reply of the Cartographie V7.1 (22/07/2026).

-- ───────────────────────── ERP: model ─────────────────────────
alter table erp_plans add column if not exists cell_safety text;     -- posts called out for a safety emergency, comma separated
alter table erp_plans add column if not exists cell_security text;   -- posts for a security emergency (and cyber)
alter table erp_plans add column if not exists deputy_rule text;     -- who leads when the AM is unavailable
alter table erp_plans add column if not exists location text;        -- crisis room, paper copy
alter table erp_plans add column if not exists triggers text;        -- events that may activate the plan, one per line

alter table erp_checklists add column if not exists code text;       -- ERP-AJD-04…
alter table erp_checklists add column if not exists applies text not null default 'all';
alter table erp_checklists drop constraint if exists erp_checklists_applies_chk;
alter table erp_checklists add constraint erp_checklists_applies_chk check (applies in ('all','safety','security','cyber','overdue'));
alter table erp_checklists add column if not exists source text;     -- MSM paragraph, or "Proposed by S.A.M."

alter table erp_contacts add column if not exists kind text not null default 'internal';
alter table erp_contacts drop constraint if exists erp_contacts_kind_chk;
alter table erp_contacts add constraint erp_contacts_kind_chk check (kind in ('internal','authority','investigation','partner','contractor','emergency'));
alter table erp_contacts add column if not exists post text;         -- NP post code: the holder in NP management wins over the name typed here
alter table erp_contacts add column if not exists deputy text;       -- deputy name (ENR-CM-15)
alter table erp_contacts add column if not exists erp_clause boolean; -- contractor: mutual ERP notification written in the contract (AJD MSM 9.3.10)

create table if not exists erp_milestones (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  plan_id uuid references erp_plans(id) on delete set null,
  label text not null,
  minutes int not null default 0,                    -- from the start of the activation; 0 = immediately
  owner_role text,
  applies text not null default 'all' check (applies in ('all','safety','security','cyber','overdue')),
  source text,
  ord int not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table erp_milestones enable row level security;
drop policy if exists erp_milestones_read on erp_milestones;
create policy erp_milestones_read on erp_milestones for select using (true);

alter table erp_activations add column if not exists scenario text not null default 'safety';
alter table erp_activations drop constraint if exists erp_activations_scenario_chk;
alter table erp_activations add constraint erp_activations_scenario_chk check (scenario in ('safety','security','cyber','overdue','other'));
alter table erp_activations add column if not exists info jsonb;     -- primary information sheet (ERP-AJD-01 / ENR-CM-15 §2)
alter table erp_activations add column if not exists is_incident uuid references is_incidents(id) on delete set null;

insert into app_params (key, value, label, hint) values
  ('erp_exercise_months','12','ERP exercise (months)','AJD MSM 9.9 and ASJ MSM 8.8: one simulated ERP a year, supervised by the SM.')
on conflict (key) do nothing;

-- ───────────────────────── ERP: plans ─────────────────────────
insert into erp_plans (entity, code, title, scope, manual_ref, version, reviewed_on, next_review, owner_role, cell_safety, cell_security, deputy_rule, location, triggers, note)
select 'ASJMT', 'MSM-9', 'Emergency response plan, Astonjet Ltd',
  'All aircraft operated by Astonjet Ltd, under the AOC or the ORO.DEC declaration (NCC). Coordinated with contracted organisations (MSM 9.3.10). Partner: GoCrisis through Aelia.',
  'MSM Iss 01 Rev 09 ch. 9; ENR-CM-15 Iss 01 Rev 01', 'Rev 09', '2026-09-11', '2027-09-11', 'SM',
  'AM, SM, NPFO, NPCA, ISM', 'AM, NPCT, SM, ISM',
  'AM unavailable: the NPGO leads the unit (MSM 9.7.2.1).',
  'Meeting room, Malta main office (MSM 9.7.1). Paper copy of the full ERP: Amelia Earhart meeting room (MSM 9.2).',
  $t$Aviation accident or serious incident
Missing or overdue aircraft
Disaster in the premises: fire, explosion, pollution, flood
Food poisoning, epidemic
Death, suicide at the workplace
Multiple victims connected to a disaster, illness or contagion
Accident to the public transportation of the personnel
Internal or external threat: attack, bomb alert, sabotage, terrorism
Accident during missions: business trip, abroad
Geopolitical events resulting in the immobilisation of crew
Loss of information systems or cyber-attack$t$,
  'Imported from the MSM on 10/11/2026.'
where not exists (select 1 from erp_plans where entity = 'ASJMT');

insert into erp_plans (entity, code, title, scope, manual_ref, version, reviewed_on, next_review, owner_role, cell_safety, cell_security, deputy_rule, location, triggers, note)
select 'ASJFR', 'MSM-8', 'Emergency response plan, Astonjet SAS',
  'All aircraft operated by Astonjet. Partner: GoCrisis through Aelia. Authority: DSAC; investigation: BEA.',
  'MSM Iss 10 Rev 07 ch. 8 (checklists still coded ERP-AJD-xx); contacts: link to the AJD ENR-CM-15', 'Rev 07', '2025-10-20', '2026-10-20', 'SM',
  'AM, SM, NPFO, NPCA, ISM', 'AM, NPCT, SM, ISM',
  'AM unavailable: the NPGO leads the unit (MSM 8.6.2.1).',
  'Meeting room, Le Bourget main office (MSM 8.6.1).',
  $t$Aviation accident or serious incident
Missing or overdue aircraft
Disaster in the premises: fire, explosion, pollution, flood
Food poisoning, epidemic
Death, suicide at the workplace
Multiple victims connected to a disaster, illness or contagion
Accident to the public transportation of the personnel
Internal or external threat: attack, bomb alert, sabotage, terrorism
Accident during missions: business trip, abroad
Geopolitical events resulting in the immobilisation of crew
Loss of information systems or cyber-attack$t$,
  'Imported from the MSM on 10/11/2026.'
where not exists (select 1 from erp_plans where entity = 'ASJFR');

insert into erp_plans (entity, code, title, scope, manual_ref, version, reviewed_on, next_review, owner_role, cell_safety, cell_security, deputy_rule, location, triggers, note)
select 'ASFFR', 'MSM-6', 'Emergency response plan, Astonfly (ATO)',
  'Training flights, premises used by Astonfly, crews immobilised abroad. Authority: DSAC; investigation: BEA.',
  'MSM Iss 10 Rev 01 ch. 6; log on ENR/CM/15 (no Astonfly form found)', 'Rev 01', '2026-09-14', '2027-09-14', 'SM',
  'AM, CFI, SM, MAM', 'AM, SM, ISM',
  'Contradiction in the MSM: the CFI leads when the AM is unavailable (6.2.1), the Vice President (6.4). To settle.',
  'Charles Lindbergh meeting room, Toussus-le-Noble (MSM 6.1).',
  $t$Aircraft accident
Accident in the premises used by Astonfly
Geopolitical events resulting in the immobilisation of crew$t$,
  'Imported from the MSM on 10/11/2026. Security scenario, cyber-attack, overdue aircraft, timings, exercises and training are not in the MSM: proposed by S.A.M.'
where not exists (select 1 from erp_plans where entity = 'ASFFR');

-- ───────────────────────── ERP: milestones ─────────────────────────
insert into erp_milestones (entity, plan_id, label, minutes, owner_role, applies, source, ord)
select e::entity_code, (select id from erp_plans where entity = e::entity_code order by created_at limit 1), m.label, m.minutes, m.owner_role, m.applies, m.source, m.ord
from (values ('ASJMT'),('ASJFR')) as x(e), (values
  ('Accountable Manager informed, decision to activate', 0, 'AM', 'all', 'MSM 9.3.5 / 8.2.5', 10),
  ('Civil aviation authority notified by phone', 0, 'SM', 'safety', 'MSM 9.2 / 8.1', 20),
  ('List of dangerous goods on board available', 0, 'NPGO', 'safety', 'MSM 9.2', 25),
  ('Preliminary passenger name list obtained', 45, 'NPFO', 'safety', 'MSM 9.4.3.1 / 8.3.3.1', 30),
  ('Emergency response centre open, unit activated', 60, 'AM', 'all', 'MSM 9.4.1 / 8.3.1', 40),
  ('First press statement issued', 60, 'AM', 'all', 'ERP-AJD-04 D', 45),
  ('First team briefing, then hourly', 60, 'AM', 'all', 'ERP-AJD-00 L', 50),
  ('Passengers and crew on board sent to the authority', 120, 'SM', 'safety', 'MSM 9.6.3 / 8.5.3', 60),
  ('Passenger list confirmed', 180, 'NPFO', 'safety', 'MSM 9.4.3.1 / ERP-AJD-00 D', 70),
  ('Written occurrence report (MOR) sent', 4320, 'SM', 'safety', 'Reg. (EU) 376/2014 art. 4, 72 h', 80),
  ('Part-IS event reported to the authority', 4320, 'ISM', 'cyber', 'IS.I.OR.230, 72 h', 85)
) as m(label, minutes, owner_role, applies, source, ord)
where not exists (select 1 from erp_milestones where entity = e::entity_code);

insert into erp_milestones (entity, plan_id, label, minutes, owner_role, applies, source, ord)
select 'ASFFR', (select id from erp_plans where entity = 'ASFFR' order by created_at limit 1), m.label, m.minutes, m.owner_role, m.applies, m.source, m.ord
from (values
  ('Accountable Manager informed (24/7)', 0, 'SM', 'all', 'MSM 6.3', 10),
  ('Emergency services on site or alerted, checked by the AM', 0, 'AM', 'all', 'MSM 6.4', 15),
  ('Members of the unit called, log opened', 30, 'SM', 'all', 'MSM 6.3 (timing proposed by S.A.M.)', 20),
  ('BEA and authority notified (accident, serious incident)', 60, 'SM', 'safety', 'Reg. (EU) 996/2010 art. 9 (timing proposed by S.A.M.)', 30),
  ('List of trainees and instructors on board available', 60, 'CFI', 'safety', 'MSM 6.2.3 (timing proposed by S.A.M.)', 40),
  ('Written occurrence report (MOR) sent', 4320, 'SM', 'safety', 'Reg. (EU) 376/2014 art. 4, 72 h', 80),
  ('Part-IS event reported to the authority', 4320, 'ISM', 'cyber', 'IS.I.OR.230, 72 h', 85)
) as m(label, minutes, owner_role, applies, source, ord)
where not exists (select 1 from erp_milestones where entity = 'ASFFR');

-- ───────────────────────── ERP: checklists (MSM text, one action per line) ─────────────────────────
create temporary table _erp_cl (code text, title text, phase text, owner_role text, applies text, items text, ord int, src text);
insert into _erp_cl values
('00','Global ERP checklist','first hour','AM','all',$t$Advise the AM and together decide whether to launch the ERP (if in doubt, launch it)
Call out the members of the unit in order of priority, with a clear brief
Put GoCrisis on standby
Obtain a provisional list of injured and fatalities, the passenger name list and crew details (confirmed within 3 hours)
Ensure all team members have been alerted
Ensure the whole unit is present, using its checklists and following procedures
Ensure admin support: logs, minutes, action lists, decision log
Activate GoCrisis
Alert third-party suppliers and put them on standby; GoCrisis call centre sets up a dedicated incident line
Inform senior managers, civil aviation (state of occurrence and own authority), client or broker
Impound aircraft records, flight crew records, dispatch records
Hold quick team briefings with the AM, hourly at first
Ensure checklists are used and chronological records kept in UTC
With the AM, ensure all interested parties are advised, staff notices issued, websites updated, bulletins and call-centre briefs issued
Consult the company lawyers and company secretary
Advise the Financial Director, set aside emergency funds, approve advance payments with GoCrisis, allocate a finance representative
Monitor the unit's personnel, provide back-up, replacement rotas and handover forms
Decide with the AM when teams stand down and the incident is closed, records filed and summary reports produced
Reconcile all emergency funds after the incident
Arrange the feedback meeting: notes and lessons learned documented, procedures amended$t$,10,'9.7.3.1'),
('02','Person receiving the accident notification','first hour','Anyone','all',$t$Complete the primary information sheet (done in S.A.M. when the alert is raised) and send it to the ERP mailbox
As soon as the notification is confirmed, call the Accountable Manager
Call additional staff so that day-to-day operation continues as near normal as possible
If applicable, collect and secure the relevant documentation$t$,20,'9.7.3.2'),
('03','Ground operations agent','first hour','NPGO','all',$t$Complete the primary information sheet and send it to the ERP mailbox
Verify the information received without delaying the call to the AM (next person on the list if the AM cannot be reached)
Once confirmed, with the AM, activate the plan by calling the persons on the call-out list
Keep the link with the local airport; the handling agent deals with local issues and freezes flight documentation
Complete the notification of an aircraft accident or incident form and forward it to the SM for the authority
Isolate and protect all flight plan data and information provided to the crew
Assess the impact on the flying programme, crew and aircraft utilisation
Gather and print all crew identity details for the flight
Make separate copies of all data; keep the originals
Prepare the handover brief for the unit
Continue to handle the incident until relieved by the unit
Log all actions
Implement the changes to the flying programme directed by the NPGO$t$,30,'9.7.3.3'),
('04','Accountable Manager','first hour','AM','all',$t$Activate the emergency response plan
Obtain the completed primary information sheet
Obtain an update briefing from the unit; inform the authorities if applicable
Within the first hour: issue the first press statement with media / PR
Decide which GoCrisis services are required
Check the unit has the right resources; designate a log keeper (S.A.M. keeps the log)
Ensure the GoCrisis international call-centre number is issued to the public (only after GoCrisis confirms a test call)
Set the policy for continued operations and relay it to stakeholders
Issue the internal staff briefing: no discussion of the accident outside the company
Notify the regulatory and investigative authorities; criminal acts: AVSEC and police; other external entities. Simply give the facts
Notify the aviation insurance broker
Notify the legal counsellor
Second hour: evaluate sending a management representative on site
Verify that all victims and next of kin receive support
Hold regular briefings with all emergency personnel
Have the original records retrieved and secured: weather, flight papers, W&B and performance, ACARS, crew records, maintenance records
Meet the authorities at regular intervals
Hold a strategic meeting with GoCrisis at least once a day
Brief the stakeholders regularly
After the incident: terminate the response and deactivate the organisation
Agree with the CMM the collation and safe storage of incident documentation
Evaluate whether a company flight or maintenance procedure may have contributed
Ensure the company is represented in investigation subcommittees; appoint a manager for the official inquiry
Prepare the answers to judicial authorities or the investigation commission
Keep the legal representative informed$t$,40,'9.7.3.4'),
('05','NPFO','first hour','NPFO','safety',$t$Obtain an update briefing and the primary information sheet
Notify and regularly update the civil aviation authority
Gather all information on the flight and the activity related to the accident
Check that the records of all crew involved are isolated and protected
Compile details and copies of documents for all crew members involved
With the NPCA, gather the technical documents of the aircraft
Do not inform crews still flying: wait until they reach their next destination and finish their duty
Ensure support to crew relatives, coordinated with the AM
Manage crew bases and ongoing rosters
Protect the CVR as per the Operations Manual
Meet the investigation teams and the authority at regular intervals$t$,50,'9.7.3.5'),
('06','Safety Manager','first hour','SM','all',$t$Obtain the primary information sheet
Establish the facts known so far
Distribute tasks to the safety team and decide who goes to site
Check for past confidential reports on the crew or the aircraft (S.A.M. safety reports)
Note any open finding that may have had a bearing on the accident (S.A.M. findings)
Isolate and protect all reports and MORs on the aircraft
With the AM, decide whether to stay with the unit or go to site
After the event: agree the closure with the AM$t$,60,'9.7.3.6'),
('07','NPGO','first hour','NPGO','safety',$t$Obtain the primary information sheet
Contact the airport operations managers at departure and destination; act as point of contact for the stations
Confirm the manifests (passengers, baggage) are secured; send the accident notification form to the state of occurrence; scans to the ERP mailbox
List all flight documents for the NPFO: weather, planning, W&B, fuel and uplift receipts, manifest, crew list
Provide logistics and equipment to anyone sent to the accident site
Collect without delay the local contacts: fire, police, ambulance, coast guard, hospitals, medical specialists, aviation or defence agencies, poison control$t$,70,'9.7.3.7'),
('08','NPCA','first hour','NPCA','safety',$t$Obtain the primary information sheet
Obtain the aircraft data: type, registration, MSN, manufacturer, year, hours and cycles, engine times, next inspection, deferred defects, last 12 months of work
Compile the continuing airworthiness documents (C of R, C of A, ARC, logs) and the maintenance records; obtain the technical log and maintenance history
Secure the flight data recorder and the cockpit voice recorder
Compile the maintenance personnel licences and training records
Notify the authority's airworthiness inspector
Provide technical support and the equipment list to the unit
Assist the investigating authorities with technical expertise
Have the maintenance organisations lock up the documents of the flight; collect copies
Have the last fuelling handling agent or FBO take a fuel sample
Keep communicating with the authorities until reports are published
Keep regular contact with the manufacturers and subcontractors
Keep originals in a secure place; get a signed list if the authorities take them$t$,80,'9.7.3.8'),
('09','ISM','first hour','ISM','all',$t$Receive the message from the AM and go to the office immediately
Lock the flight details in the IT systems; only authorised staff access the passenger name record
Ensure all communication equipment works
Check the GoCrisis emergency call centre is active$t$,90,'9.7.3.9'),
('OD','Aircraft overdue','alert','NPGO','overdue',$t$ETA + 15 min: ground operations agent reviews the itinerary and starts a communications search
ETA + 15 min: contact the NPGO with the itinerary (NPFO if the NPGO is unavailable)
ETA + 30 min: NPFO or NPGO contacts the air traffic control unit
ETA + 30 min: continue the communications search, contact search and rescue
ETA + 30 min: contact the AM for ERP management$t$,5,'9.6.1.2');

-- AJD: as written in the MSM
insert into erp_checklists (entity, plan_id, code, title, phase, owner_role, applies, items, ord, source)
select 'ASJMT', (select id from erp_plans where entity = 'ASJMT' order by created_at limit 1),
  case when c.code = 'OD' then null else 'ERP-AJD-' || c.code end, c.title, c.phase, c.owner_role, c.applies,
  replace(replace(c.items, 'civil aviation authority', 'TM-CAD (DGCA)'), 'the authority''s airworthiness inspector', 'the TM-CAD airworthiness inspector'),
  c.ord, 'AJD MSM ' || c.src
from _erp_cl c
where not exists (select 1 from erp_checklists where entity = 'ASJMT');

-- ASJ: same checklists, French authorities, coded ERP-ASJ (the MSM still says ERP-AJD), plus the RCC item of ERP-AJD-08 Rev 07
insert into erp_checklists (entity, plan_id, code, title, phase, owner_role, applies, items, ord, source)
select 'ASJFR', (select id from erp_plans where entity = 'ASJFR' order by created_at limit 1),
  case when c.code = 'OD' then null else 'ERP-ASJ-' || c.code end, c.title, c.phase, c.owner_role, c.applies,
  case when c.code = '08' then replace(replace(c.items, 'the authority''s airworthiness inspector', 'the DSAC airworthiness inspector'), 'Provide technical support and the equipment list to the unit', 'Provide technical support and the equipment list to the unit' || chr(10) || 'Give the rescue coordination centres the lists of emergency and survival equipment on board')
       else replace(c.items, 'civil aviation authority', 'DSAC (on-call structure)') end,
  c.ord, 'ASJ MSM ' || replace(replace(c.src, '9.7.3', '8.6.3'), '9.6.1', '8.5.1') || case when c.code = 'OD' then '' else ' (coded ERP-AJD-' || c.code || ' in the MSM)' end
from _erp_cl c
where not exists (select 1 from erp_checklists where entity = 'ASJFR');

-- ASF: the MSM has no checklist; these are the unit roles of MSM 6.2 and 6.4 turned into actions
insert into erp_checklists (entity, plan_id, code, title, phase, owner_role, applies, items, ord, source)
select 'ASFFR', (select id from erp_plans where entity = 'ASFFR' order by created_at limit 1), x.code, x.title, x.phase, x.owner_role, x.applies, x.items, x.ord, x.src
from (values
('ERP-ASF-01','First person informed','first hour','Anyone','all',$t$Pass the information 24/7 to a postholder, who informs the Accountable Manager
Raise the alert in S.A.M. (primary information sheet)
First on the scene prepares the crisis room$t$,10,'ASF MSM 6.3'),
('ERP-ASF-02','Accountable Manager','first hour','AM','all',$t$Decide whether the situation requires the plan; have every unit member called
Before any action, check the emergency services are on site or at least alerted
Aircraft accident: call and e-mail the border police, the aircraft insurer, the BEA, the aircraft owner
Accident in the premises: border police, premises insurer, airport authorities, prefecture, fire brigade as useful
Crew immobilised abroad: aircraft insurer, Ministry of Foreign Affairs
Assign the roles below to the people available
Prepare media releases with the lawyer, or appoint a media contact
Keep the unaffected activities running
Ensure the return to normal and close the unit$t$,20,'ASF MSM 6.2.1, 6.4, 6.5'),
('ERP-ASF-03','SMS Manager','first hour','SM','all',$t$Open the emergency response log (S.A.M. activation log)
Liaise with the BEA and the authorities to facilitate the investigation
Manage the communication with the police and gendarmerie for a safety occurrence
File the occurrence report$t$,30,'ASF MSM 6.2.2, 6.3'),
('ERP-ASF-04','CFI','first hour','CFI','safety',$t$Provide the air operations expertise to the unit
Give the unit the registration, list of trainees and instructors, flight number and flight plan
Give the instructor and trainee schedule and the trainee's training booklet
Gather every document of the flight, with the Operations Manager and the HT$t$,40,'ASF MSM 6.2.3'),
('ERP-ASF-05','Maintenance and Airworthiness Manager','first hour','MAM','safety',$t$Give the unit the technical status of the aircraft: airworthiness status, technical documentation, TL archive
Give the on-board documents (CI, CEN, AC)
Gather the continuing airworthiness documents (AC, equipment, engine booklets, CARDEX) for the authorities
Inform the maintenance workshop
Support the recovery of the wreckage once released by the investigators$t$,50,'ASF MSM 6.2.4, 6.4'),
('ERP-ASF-06','Customer service','first day','Assigned by the AM','all',$t$Contact the customers affected, in line with the contract
Contact the subcontractors affected
Update the website when new elements are confirmed$t$,60,'ASF MSM 6.4'),
('ERP-ASF-07','Human resources','first day','Assigned by the AM','all',$t$Brief the staff on the situation and what to do
Provide the documents of the staff involved and keep them for the authorities
Ensure management offers condolences to the relatives of the deceased
Deal with emotional trauma; contact the nearest hospital or the medical-psychological emergency unit (CUMP)$t$,70,'ASF MSM 6.4'),
('ERP-ASF-08','Legal','first day','Assigned by the AM','all',$t$Review every statement before release
Advise on legal and insurance issues$t$,80,'ASF MSM 6.4'),
('ERP-ASF-09','Security','first hour','Assigned by the AM','all',$t$Restrict access to the head office and offices
Check identity and badge of everyone entering
Escort external people
Secure the other buildings: hangars, car parks
Supervise the media if allowed on site
Inform the relevant official organisation in real time$t$,90,'ASF MSM 6.4'),
('ERP-ASF-10','Assistance to people','first day','Assigned by the AM','all',$t$Prepare a room for the families, or inform the families of victims who are not travelling
Book hotel rooms
Locate the hospitals where the victims were taken
Organise transport for families and survivors
Provide a place for storing and returning personal effects$t$,100,'ASF MSM 6.4'),
('ERP-ASF-11','Secretariat','first hour','Assigned by the AM','all',$t$Keep the emergency log up to date (S.A.M. log)
Keep the list of people contacted up to date (name, address, phones, e-mail)$t$,110,'ASF MSM 6.4'),
('ERP-ASF-12','Closing','recovery','AM','all',$t$Check the closing conditions: aircraft recovered, victims supported, investigation launched
Keep the unit's documents 5 years if the authorities investigate, otherwise at least 3 years; destroy nothing
Hold the debrief and record the lessons learned$t$,120,'ASF MSM 6.5'),
('ERP-ASF-13','Information security event','first hour','ISM','cyber',$t$Isolate the affected system and keep the evidence
Assess the impact on training flights and safety data
Record the event in Part-IS events (opened by S.A.M.)
Report to the authority within 72 h if the event is significant (IS.I.OR.230)$t$,130,'Proposed by S.A.M. (Part-IS, not in the ASF MSM)')
) as x(code, title, phase, owner_role, applies, items, ord, src)
where not exists (select 1 from erp_checklists where entity = 'ASFFR');

drop table _erp_cl;

-- cyber-attack checklist for AJD and ASJ (trigger in the MSM, no checklist besides ERP-AJD-09)
insert into erp_checklists (entity, plan_id, code, title, phase, owner_role, applies, items, ord, source)
select e::entity_code, (select id from erp_plans where entity = e::entity_code order by created_at limit 1), null, 'Information security event', 'first hour', 'ISM', 'cyber',
$t$Isolate the affected system and keep the evidence (logs, accounts, messages)
Assess the impact on flights, dispatch, maintenance and safety data (Part-IS systems register)
Switch to the fallback means: paper, phone, the printed ERP binder
Record the event in Part-IS events (opened by S.A.M.)
Report to the authority within 72 h if the event is significant (IS.I.OR.230)$t$, 95, 'Proposed by S.A.M. (trigger listed in the MSM, no checklist)'
from (values ('ASJMT'),('ASJFR')) as x(e)
where not exists (select 1 from erp_checklists where entity = e::entity_code and applies = 'cyber');

-- ───────────────────────── ERP: crisis directory (ENR-CM-15), without personal mobile numbers ─────────────────────────
insert into erp_contacts (entity, kind, post, crisis_role, name, deputy, organisation, phone, email, available, ord, note)
select 'ASJMT', x.kind, x.post, x.role, x.name, x.deputy, x.org, x.phone, x.email, x.av, x.ord, x.note
from (values
('internal','AM','Accountable Manager, leads the unit','Charles CLAIR',null,'Astonjet Ltd',null,null,'24/7',10,null),
('internal','NPGO','Nominated person ground operations, leads if the AM is unavailable','Maxime BABILLOT','Haifa HOSNI','Astonjet Ltd',null,null,'24/7',20,'MSM 9.2 gives a number, ENR-CM-15 none: enter the right one.'),
('internal','NPCT','NPCT and Security Manager','Christophe WARNKE DHERINES','Luca BANDINI','Astonjet Ltd',null,null,'24/7',30,null),
('internal','NPFO','Nominated person flight operations','Federico SERMARINI','Akrit KALWAR JAISWAL','Astonjet Ltd',null,null,'24/7',40,'MSM 9.2 and ENR-CM-15 give two different numbers: confirm.'),
('internal','SM','CMM and Safety Manager','Guillaume FOURNIE','Donato RUSSO (SM), Pierre-Franck JANSSENS (CMM)','Astonjet Ltd',null,null,'24/7',50,null),
('internal','NPCA','Nominated person continuing airworthiness','Kevin MARTIN','Filip ALEXANDRIS','Astonjet Ltd',null,null,'24/7',60,null),
('internal','ISM','Information Security Manager','Steve ASSOUVIE','Donato RUSSO','IOR System',null,null,'24/7',70,null),
('internal',null,'General Manager','Mélanie VAILLANT',null,'Astonjet',null,null,null,80,'In ENR-CM-15, not in MSM 9.2.'),
('internal',null,'Head of HR','Marlene AQUILINA',null,'Clair Group',null,null,null,90,null),
('internal',null,'ERP mailbox: primary information sheet, manifests',null,null,'Astonjet','','erp@astonjet.com',null,95,null),
('authority',null,'Director General for Civil Aviation','Charles PACE','Safety Management Unit','Transport Malta CAD','+356 77429549','charles.pace@transport.gov.mt','24/7',100,'ERP-AJD-05 prints +356 7942 9549: wrong, corrected here. Safety Management Unit: aviationsafety.tm@transport.gov.mt'),
('investigation',null,'Accident investigation (hot-line 24/7)',null,null,'BAAI Malta','+356 99382725',null,'24/7',110,null),
('authority',null,'Aviation security',null,null,'AVSEC Malta',null,null,null,120,'Listed in ENR-CM-15 without a number: to complete.'),
('partner',null,'Crisis response partner (UK 24 h line)',null,null,'GoCrisis','+44 1932 903 044','cmc@gocrisis.com','24/7',130,'USA +1 917 781 3314, AUS +61 8 9479 1872, China +86 400 1200 755; contingency +44 1932 903 033, +44 77 757 60978, +44 781 6661185. Copy aelia@aelia-assurances.com on every e-mail.'),
('partner',null,'Insurance broker',null,null,'Aelia Assurances',null,'aelia@aelia-assurances.com',null,140,null)
) as x(kind, post, role, name, deputy, org, phone, email, av, ord, note)
where not exists (select 1 from erp_contacts where entity = 'ASJMT');

insert into erp_contacts (entity, kind, post, crisis_role, name, deputy, organisation, phone, email, available, ord, note)
select 'ASJFR', x.kind, x.post, x.role, x.name, x.deputy, x.org, x.phone, x.email, x.av, x.ord, x.note
from (values
('internal','AM','Accountable Manager, leads the unit','Charles CLAIR',null,'Astonjet',null,null,'24/7',10,null),
('internal','NPGO','Nominated person ground operations, leads if the AM is unavailable','Mélanie VAILLANT',null,'Astonjet',null,null,'24/7',20,null),
('internal','NPFO','NPFO, NPCT and Security Manager','Laurent HEIM',null,'Astonjet',null,null,'24/7',30,null),
('internal','SM','CMM and Safety Manager','Guillaume FOURNIE',null,'Astonjet',null,null,'24/7',50,null),
('internal','NPCA','Nominated person continuing airworthiness','Kevin MARTIN',null,'Astonjet',null,null,'24/7',60,null),
('internal','ISM','Information Security Manager','Steve ASSOUVIE',null,'IOR System',null,null,'24/7',70,null),
('internal',null,'ERP mailbox: primary information sheet, manifests',null,null,'Astonjet',null,'erp@astonjet.com',null,95,null),
('authority',null,'DSAC on-call structure, Nord',null,null,'DGAC / DSAC','06 07 33 87 03',null,'24/7',100,null),
('authority',null,'DSAC on-call structure, Sud',null,null,'DGAC / DSAC','06 26 09 57 02',null,'24/7',105,null),
('investigation',null,'Accident investigation',null,null,'BEA',null,null,'24/7',110,'Not in the MSM: add the BEA duty number.'),
('partner',null,'Crisis response partner (UK 24 h line)',null,null,'GoCrisis','+44 1932 903 044','cmc@gocrisis.com','24/7',130,'Same agreement as AJD; copy aelia@aelia-assurances.com.'),
('partner',null,'Insurance broker',null,null,'Aelia Assurances',null,'aelia@aelia-assurances.com',null,140,null)
) as x(kind, post, role, name, deputy, org, phone, email, av, ord, note)
where not exists (select 1 from erp_contacts where entity = 'ASJFR');

insert into erp_contacts (entity, kind, post, crisis_role, name, deputy, organisation, phone, email, available, ord, note)
select 'ASFFR', x.kind, x.post, x.role, null, null, x.org, null, null, x.av, x.ord, x.note
from (values
('internal','AM','Accountable Manager, leads the unit','Astonfly','24/7',10,null),
('internal','CFI','Chief Flight Instructor','Astonfly','24/7',20,'Leads if the AM is unavailable (MSM 6.2.1).'),
('internal','SM','SMS Manager','Astonfly','24/7',30,null),
('internal','MAM','Maintenance and Airworthiness Manager','Astonfly','24/7',40,null),
('investigation',null,'Accident investigation','BEA','24/7',100,'Number to add (the MSM refers to an ENR/CM/15 annex that does not exist for Astonfly).'),
('authority',null,'Police aux frontières','Police','24/7',110,null),
('partner',null,'Aircraft insurer','Insurer',null,120,null),
('partner',null,'Aircraft owner','Owner',null,130,null),
('partner',null,'Premises insurer','Insurer',null,140,null),
('authority',null,'Crisis centre, Ministry of Foreign Affairs','MEAE','24/7',150,'Crew immobilised abroad.'),
('emergency',null,'Medical-psychological emergency unit','CUMP / SAMU','24/7',160,null)
) as x(kind, post, role, org, av, ord, note)
where not exists (select 1 from erp_contacts where entity = 'ASFFR');

-- ───────────────────────── Part-IS: model ─────────────────────────
alter table is_systems add column if not exists ref text;            -- cartography id, shared by the rows of each entity
alter table is_systems add column if not exists short text;          -- one-line role
alter table is_systems add column if not exists dept text;
alter table is_systems add column if not exists zone text;           -- g_compta g_hr g_it g_mkt g_own g_gen trans fo camo go training caa asf pending
alter table is_systems add column if not exists scope text[];        -- entities in the cartography (AJD, ASJ, ASF, GRP)
alter table is_systems add column if not exists resp text;           -- own | grp | auth
alter table is_systems drop constraint if exists is_systems_resp_chk;
alter table is_systems add constraint is_systems_resp_chk check (resp is null or resp in ('own','grp','auth'));
alter table is_systems add column if not exists contract text;       -- ok | tbc | none
alter table is_systems drop constraint if exists is_systems_contract_chk;
alter table is_systems add constraint is_systems_contract_chk check (contract is null or contract in ('ok','tbc','none'));
alter table is_systems add column if not exists ops_impact text;     -- Y | N | ?
alter table is_systems add column if not exists purpose text;
alter table is_systems add column if not exists status text not null default 'confirmed';
alter table is_systems drop constraint if exists is_systems_status_chk;
alter table is_systems add constraint is_systems_status_chk check (status in ('confirmed','to_confirm','awaiting'));
alter table is_systems add column if not exists attention text;      -- critical | serious | warning
alter table is_systems drop constraint if exists is_systems_attention_chk;
alter table is_systems add constraint is_systems_attention_chk check (attention is null or attention in ('critical','serious','warning'));
alter table is_systems add column if not exists ring int;            -- 1 critical, 2 standard, 3 lower risk
alter table is_systems add column if not exists source text;
alter table is_systems add column if not exists reviewed_on date;
create index if not exists is_systems_ref on is_systems (ref);

-- ───────────────────────── Part-IS: seed from the Cartographie V7.1 (22/07/2026) ─────────────────────────
insert into is_systems (entity, ref, name, short, kind, dept, zone, scope, resp, contract, ops_impact, purpose, data, hosting, provider, status, attention, ring, criticality, safety_relevant, note, source)
select v.* from (values
('ASJMT'::entity_code, 'sage', 'SAGE (suite ×6)', 'General accounting', 'Accounting', 'Accounting', 'g_compta', array['GRP']::text[], 'grp', 'tbc', 'Y', 'Accounting, invoicing, fixed assets, treasury, payments, banking communication', 'Financial', 'Cloud/Local TBC', 'Sage (via CGSMT)', 'confirmed', null, 2, 'medium', true, 'Operational impact declared Y by Finance — indirect safety impact to be assessed', 'F. Lescene'),
('ASJFR'::entity_code, 'sage', 'SAGE (suite ×6)', 'General accounting', 'Accounting', 'Accounting', 'g_compta', array['GRP']::text[], 'grp', 'tbc', 'Y', 'Accounting, invoicing, fixed assets, treasury, payments, banking communication', 'Financial', 'Cloud/Local TBC', 'Sage (via CGSMT)', 'confirmed', null, 2, 'medium', true, 'Operational impact declared Y by Finance — indirect safety impact to be assessed', 'F. Lescene'),
('ASFFR'::entity_code, 'sage', 'SAGE (suite ×6)', 'General accounting', 'Accounting', 'Accounting', 'g_compta', array['GRP']::text[], 'grp', 'tbc', 'Y', 'Accounting, invoicing, fixed assets, treasury, payments, banking communication', 'Financial', 'Cloud/Local TBC', 'Sage (via CGSMT)', 'confirmed', null, 2, 'medium', true, 'Operational impact declared Y by Finance — indirect safety impact to be assessed', 'F. Lescene'),
('ASJMT'::entity_code, 'billingpro', 'Billing-pro', 'Leon → Sage interface', 'Accounting', 'Accounting', 'g_compta', array['GRP']::text[], 'grp', 'tbc', '?', 'Leon → Sage interface: generates accounting entries from Leon invoices', 'Financial', 'Cloud', '?', 'confirmed', null, 2, 'low', true, 'Use clarified by CSM 22/07/2026
Interface between Leon (critical system) and Sage: data flow to be covered in the interface register', 'R. Mahmoud / CSM'),
('ASJFR'::entity_code, 'billingpro', 'Billing-pro', 'Leon → Sage interface', 'Accounting', 'Accounting', 'g_compta', array['GRP']::text[], 'grp', 'tbc', '?', 'Leon → Sage interface: generates accounting entries from Leon invoices', 'Financial', 'Cloud', '?', 'confirmed', null, 2, 'low', true, 'Use clarified by CSM 22/07/2026
Interface between Leon (critical system) and Sage: data flow to be covered in the interface register', 'R. Mahmoud / CSM'),
('ASFFR'::entity_code, 'billingpro', 'Billing-pro', 'Leon → Sage interface', 'Accounting', 'Accounting', 'g_compta', array['GRP']::text[], 'grp', 'tbc', '?', 'Leon → Sage interface: generates accounting entries from Leon invoices', 'Financial', 'Cloud', '?', 'confirmed', null, 2, 'low', true, 'Use clarified by CSM 22/07/2026
Interface between Leon (critical system) and Sage: data flow to be covered in the interface register', 'R. Mahmoud / CSM'),
('ASJMT'::entity_code, 'eurecia', 'Eurecia', 'HR management', 'HR', 'HR', 'g_hr', array['GRP']::text[], 'grp', 'tbc', 'N', 'HR management', 'HR / personnel', 'Cloud', 'Eurecia (CGPFR-CGSMT)', 'confirmed', null, 2, 'low', false, 'Personnel data — trustworthiness link IS.I.OR.240(i) and GDPR', 'C. Clair'),
('ASJFR'::entity_code, 'eurecia', 'Eurecia', 'HR management', 'HR', 'HR', 'g_hr', array['GRP']::text[], 'grp', 'tbc', 'N', 'HR management', 'HR / personnel', 'Cloud', 'Eurecia (CGPFR-CGSMT)', 'confirmed', null, 2, 'low', false, 'Personnel data — trustworthiness link IS.I.OR.240(i) and GDPR', 'C. Clair'),
('ASFFR'::entity_code, 'eurecia', 'Eurecia', 'HR management', 'HR', 'HR', 'g_hr', array['GRP']::text[], 'grp', 'tbc', 'N', 'HR management', 'HR / personnel', 'Cloud', 'Eurecia (CGPFR-CGSMT)', 'confirmed', null, 2, 'low', false, 'Personnel data — trustworthiness link IS.I.OR.240(i) and GDPR', 'C. Clair'),
('ASJMT'::entity_code, 'recruitee', 'Recruitee', 'Recruitment', 'HR', 'HR', 'g_hr', array['GRP']::text[], 'grp', 'tbc', 'N', 'Recruitment', 'Candidates', 'Cloud', 'Recruitee', 'confirmed', null, 2, 'low', false, 'Assigned to HR Clair Group — CSM decision 22/07/2026', 'R. Mahmoud'),
('ASJFR'::entity_code, 'recruitee', 'Recruitee', 'Recruitment', 'HR', 'HR', 'g_hr', array['GRP']::text[], 'grp', 'tbc', 'N', 'Recruitment', 'Candidates', 'Cloud', 'Recruitee', 'confirmed', null, 2, 'low', false, 'Assigned to HR Clair Group — CSM decision 22/07/2026', 'R. Mahmoud'),
('ASFFR'::entity_code, 'recruitee', 'Recruitee', 'Recruitment', 'HR', 'HR', 'g_hr', array['GRP']::text[], 'grp', 'tbc', 'N', 'Recruitment', 'Candidates', 'Cloud', 'Recruitee', 'confirmed', null, 2, 'low', false, 'Assigned to HR Clair Group — CSM decision 22/07/2026', 'R. Mahmoud'),
('ASJMT'::entity_code, 'glpi', 'GLPI', 'Ticketing + IT asset inventory', 'IT', 'IT', 'g_it', array['GRP']::text[], 'grp', 'tbc', 'N', 'Ticketing and IT hardware stock inventory', 'IT / hardware assets', 'Cloud', 'CGSMT', 'confirmed', null, 2, 'low', false, 'Use clarified by CSM 22/07/2026: IT hardware inventory
Useful support for the Part-IS asset inventory and IS incident traceability', 'C. Clair / CSM'),
('ASJFR'::entity_code, 'glpi', 'GLPI', 'Ticketing + IT asset inventory', 'IT', 'IT', 'g_it', array['GRP']::text[], 'grp', 'tbc', 'N', 'Ticketing and IT hardware stock inventory', 'IT / hardware assets', 'Cloud', 'CGSMT', 'confirmed', null, 2, 'low', false, 'Use clarified by CSM 22/07/2026: IT hardware inventory
Useful support for the Part-IS asset inventory and IS incident traceability', 'C. Clair / CSM'),
('ASFFR'::entity_code, 'glpi', 'GLPI', 'Ticketing + IT asset inventory', 'IT', 'IT', 'g_it', array['GRP']::text[], 'grp', 'tbc', 'N', 'Ticketing and IT hardware stock inventory', 'IT / hardware assets', 'Cloud', 'CGSMT', 'confirmed', null, 2, 'low', false, 'Use clarified by CSM 22/07/2026: IT hardware inventory
Useful support for the Part-IS asset inventory and IS incident traceability', 'C. Clair / CSM'),
('ASJMT'::entity_code, 'optima', 'Optima Box', 'Office & room access', 'IT', 'IT', 'g_it', array['GRP']::text[], 'grp', 'tbc', 'N', 'Office and meeting-room access management', 'Physical access', '?', 'CGSMT', 'confirmed', null, 2, 'low', false, 'Use clarified by CSM 22/07/2026
Physical domain of the ISMS (access control)', 'C. Clair / CSM'),
('ASJFR'::entity_code, 'optima', 'Optima Box', 'Office & room access', 'IT', 'IT', 'g_it', array['GRP']::text[], 'grp', 'tbc', 'N', 'Office and meeting-room access management', 'Physical access', '?', 'CGSMT', 'confirmed', null, 2, 'low', false, 'Use clarified by CSM 22/07/2026
Physical domain of the ISMS (access control)', 'C. Clair / CSM'),
('ASFFR'::entity_code, 'optima', 'Optima Box', 'Office & room access', 'IT', 'IT', 'g_it', array['GRP']::text[], 'grp', 'tbc', 'N', 'Office and meeting-room access management', 'Physical access', '?', 'CGSMT', 'confirmed', null, 2, 'low', false, 'Use clarified by CSM 22/07/2026
Physical domain of the ISMS (access control)', 'C. Clair / CSM'),
('ASJMT'::entity_code, 'morpho', 'Morpho Manager', 'Biometric fingerprints', 'IT', 'IT', 'g_it', array['GRP']::text[], 'grp', 'tbc', 'N', 'Fingerprint enrolment — biometric access control', 'Biometrics / physical access', 'Local ?', 'IDEMIA', 'confirmed', 'warning', 2, 'low', false, 'Use clarified by CSM 22/07/2026
Biometric data: high GDPR sensitivity — processing and retention to be documented
Physical domain of the ISMS', 'R. Mahmoud / CSM'),
('ASJFR'::entity_code, 'morpho', 'Morpho Manager', 'Biometric fingerprints', 'IT', 'IT', 'g_it', array['GRP']::text[], 'grp', 'tbc', 'N', 'Fingerprint enrolment — biometric access control', 'Biometrics / physical access', 'Local ?', 'IDEMIA', 'confirmed', 'warning', 2, 'low', false, 'Use clarified by CSM 22/07/2026
Biometric data: high GDPR sensitivity — processing and retention to be documented
Physical domain of the ISMS', 'R. Mahmoud / CSM'),
('ASFFR'::entity_code, 'morpho', 'Morpho Manager', 'Biometric fingerprints', 'IT', 'IT', 'g_it', array['GRP']::text[], 'grp', 'tbc', 'N', 'Fingerprint enrolment — biometric access control', 'Biometrics / physical access', 'Local ?', 'IDEMIA', 'confirmed', 'warning', 2, 'low', false, 'Use clarified by CSM 22/07/2026
Biometric data: high GDPR sensitivity — processing and retention to be documented
Physical domain of the ISMS', 'R. Mahmoud / CSM'),
('ASJMT'::entity_code, 'web', 'Websites (AWS / AMEN)', 'Websites', 'Marketing', 'Marketing', 'g_mkt', array['GRP']::text[], 'grp', 'tbc', 'N', 'Websites', 'Public', 'Cloud', 'AWS / AMEN', 'confirmed', null, 2, 'low', false, 'Assigned to Marketing Clair Group — CSM decision 22/07/2026', 'R. Mahmoud'),
('ASJFR'::entity_code, 'web', 'Websites (AWS / AMEN)', 'Websites', 'Marketing', 'Marketing', 'g_mkt', array['GRP']::text[], 'grp', 'tbc', 'N', 'Websites', 'Public', 'Cloud', 'AWS / AMEN', 'confirmed', null, 2, 'low', false, 'Assigned to Marketing Clair Group — CSM decision 22/07/2026', 'R. Mahmoud'),
('ASFFR'::entity_code, 'web', 'Websites (AWS / AMEN)', 'Websites', 'Marketing', 'Marketing', 'g_mkt', array['GRP']::text[], 'grp', 'tbc', 'N', 'Websites', 'Public', 'Cloud', 'AWS / AMEN', 'confirmed', null, 2, 'low', false, 'Assigned to Marketing Clair Group — CSM decision 22/07/2026', 'R. Mahmoud'),
('ASJMT'::entity_code, 'ovh', 'OVH', 'Web hosting / services?', 'Marketing', 'Marketing', 'g_mkt', array['GRP']::text[], 'grp', 'tbc', '?', 'Websites / hosting — exact services to be reviewed with IT', 'Infrastructure', 'Cloud', 'OVH', 'to_confirm', 'warning', 2, 'low', true, 'CSM decision 22/07/2026: exact services to be clarified with IT (mail? DNS? hosting?)
Infrastructure building block: dependency to be qualified', 'R. Mahmoud / CSM'),
('ASJFR'::entity_code, 'ovh', 'OVH', 'Web hosting / services?', 'Marketing', 'Marketing', 'g_mkt', array['GRP']::text[], 'grp', 'tbc', '?', 'Websites / hosting — exact services to be reviewed with IT', 'Infrastructure', 'Cloud', 'OVH', 'to_confirm', 'warning', 2, 'low', true, 'CSM decision 22/07/2026: exact services to be clarified with IT (mail? DNS? hosting?)
Infrastructure building block: dependency to be qualified', 'R. Mahmoud / CSM'),
('ASFFR'::entity_code, 'ovh', 'OVH', 'Web hosting / services?', 'Marketing', 'Marketing', 'g_mkt', array['GRP']::text[], 'grp', 'tbc', '?', 'Websites / hosting — exact services to be reviewed with IT', 'Infrastructure', 'Cloud', 'OVH', 'to_confirm', 'warning', 2, 'low', true, 'CSM decision 22/07/2026: exact services to be clarified with IT (mail? DNS? hosting?)
Infrastructure building block: dependency to be qualified', 'R. Mahmoud / CSM'),
('ASJMT'::entity_code, 'avinode', 'Avinode / Paynode', 'Charter sales & payments', 'Marketing / Owner', 'Marketing / Owner', 'g_own', array['ASJMT']::text[], 'grp', 'tbc', 'N', 'Charter marketplace and payments', 'Commercial', 'Cloud', 'Avinode Group', 'confirmed', null, 2, 'low', false, 'Assigned to Marketing/Owner Clair Group — CSM decision 22/07/2026', 'C. Clair / R. Mahmoud'),
('ASJMT'::entity_code, 'portside', 'Portside', 'Owner invoicing', 'Marketing / Owner', 'Marketing / Owner', 'g_own', array['ASJMT','ASJFR']::text[], 'grp', 'tbc', '?', 'Aircraft owner invoicing and data communication to owners — accounting, sales, management', 'Financial / owner data', 'Cloud', 'Portside', 'confirmed', null, 2, 'low', true, 'Use clarified by CSM 22/07/2026
Data sent to third parties (owners): confidentiality and accuracy to be covered', 'C. Clair / CSM'),
('ASJFR'::entity_code, 'portside', 'Portside', 'Owner invoicing', 'Marketing / Owner', 'Marketing / Owner', 'g_own', array['ASJMT','ASJFR']::text[], 'grp', 'tbc', '?', 'Aircraft owner invoicing and data communication to owners — accounting, sales, management', 'Financial / owner data', 'Cloud', 'Portside', 'confirmed', null, 2, 'low', true, 'Use clarified by CSM 22/07/2026
Data sent to third parties (owners): confidentiality and accuracy to be covered', 'C. Clair / CSM'),
('ASJMT'::entity_code, 'm365', 'Microsoft 365', 'Mail, storage, data', 'Generic', 'Generic', 'g_gen', array['ASJMT','ASJFR','ASFFR','GRP']::text[], 'grp', 'tbc', 'Y', 'Teams, Outlook, OneDrive, Power BI — communication, messaging, data storage and sharing', 'All data (ops, safety, HR, finance)', 'Cloud', 'Microsoft', 'confirmed', 'serious', 2, 'medium', true, 'Assigned to Generic Clair Group — CSM decision 22/07/2026
Cross-cutting for all entities: no.1 vector of operational data circulation
Group interface to be contracted', 'F. Sermarini / R. Mahmoud'),
('ASJFR'::entity_code, 'm365', 'Microsoft 365', 'Mail, storage, data', 'Generic', 'Generic', 'g_gen', array['ASJMT','ASJFR','ASFFR','GRP']::text[], 'grp', 'tbc', 'Y', 'Teams, Outlook, OneDrive, Power BI — communication, messaging, data storage and sharing', 'All data (ops, safety, HR, finance)', 'Cloud', 'Microsoft', 'confirmed', 'serious', 2, 'medium', true, 'Assigned to Generic Clair Group — CSM decision 22/07/2026
Cross-cutting for all entities: no.1 vector of operational data circulation
Group interface to be contracted', 'F. Sermarini / R. Mahmoud'),
('ASFFR'::entity_code, 'm365', 'Microsoft 365', 'Mail, storage, data', 'Generic', 'Generic', 'g_gen', array['ASJMT','ASJFR','ASFFR','GRP']::text[], 'grp', 'tbc', 'Y', 'Teams, Outlook, OneDrive, Power BI — communication, messaging, data storage and sharing', 'All data (ops, safety, HR, finance)', 'Cloud', 'Microsoft', 'confirmed', 'serious', 2, 'medium', true, 'Assigned to Generic Clair Group — CSM decision 22/07/2026
Cross-cutting for all entities: no.1 vector of operational data circulation
Group interface to be contracted', 'F. Sermarini / R. Mahmoud'),
('ASJMT'::entity_code, 'monday', 'Monday', 'Project management', 'Generic', 'Generic', 'g_gen', array['GRP']::text[], 'grp', 'tbc', '?', 'Project management', 'Projects', 'Cloud', 'monday.com', 'confirmed', null, 2, 'low', true, 'Assigned to Generic Clair Group — CSM decision 22/07/2026', 'R. Mahmoud'),
('ASJFR'::entity_code, 'monday', 'Monday', 'Project management', 'Generic', 'Generic', 'g_gen', array['GRP']::text[], 'grp', 'tbc', '?', 'Project management', 'Projects', 'Cloud', 'monday.com', 'confirmed', null, 2, 'low', true, 'Assigned to Generic Clair Group — CSM decision 22/07/2026', 'R. Mahmoud'),
('ASFFR'::entity_code, 'monday', 'Monday', 'Project management', 'Generic', 'Generic', 'g_gen', array['GRP']::text[], 'grp', 'tbc', '?', 'Project management', 'Projects', 'Cloud', 'monday.com', 'confirmed', null, 2, 'low', true, 'Assigned to Generic Clair Group — CSM decision 22/07/2026', 'R. Mahmoud'),
('ASJMT'::entity_code, 'centrik', 'Centrik', 'SMS, reporting, CAPA', 'Transverse — all services', 'Transverse — all services', 'trans', array['ASJMT','ASJFR']::text[], 'own', 'ok', 'Y', 'SMS, reporting (incl. ISR information security reports), CAPA, hazard log, training records', 'Safety / Compliance / Training', 'Cloud', 'TrustFlight (Centrik)', 'confirmed', 'critical', 1, 'high', true, 'Classified critical — CSM review 22/07/2026
Dual-entity single point of failure: the internal IS reporting channel (IS.I.OR.215) relies on it
Contract held by AJD — also covers ASJ use (confirmed by CSM 22/07/2026)
For ASJ: interface with an organisation subject to Part-IS (AJD) — category i of AMC1 205(b)', 'C. Clair / F. Sermarini'),
('ASJFR'::entity_code, 'centrik', 'Centrik', 'SMS, reporting, CAPA', 'Transverse — all services', 'Transverse — all services', 'trans', array['ASJMT','ASJFR']::text[], 'grp', 'ok', 'Y', 'SMS, reporting (incl. ISR information security reports), CAPA, hazard log, training records', 'Safety / Compliance / Training', 'Cloud', 'TrustFlight (Centrik)', 'confirmed', 'critical', 1, 'high', true, 'Classified critical — CSM review 22/07/2026
Dual-entity single point of failure: the internal IS reporting channel (IS.I.OR.215) relies on it
Contract held by AJD — also covers ASJ use (confirmed by CSM 22/07/2026)
For ASJ: interface with an organisation subject to Part-IS (AJD) — category i of AMC1 205(b)', 'C. Clair / F. Sermarini'),
('ASJMT'::entity_code, 'leon', 'Leon', 'Flight planning & ops', 'Transverse — all services', 'Transverse — all services', 'trans', array['ASJMT','ASJFR']::text[], 'own', 'tbc', 'Y', 'Flight planning, data distribution, operational control', 'Flight Ops', 'Cloud', 'Leon Software', 'confirmed', 'critical', 1, 'high', true, 'Classified critical — CSM review 22/07/2026
Dual-entity single point of failure for operational control
No local redundancy identified
Feeds Billing-pro → Sage (invoicing flow)
Contract holder to be confirmed', 'C. Clair / F. Sermarini'),
('ASJFR'::entity_code, 'leon', 'Leon', 'Flight planning & ops', 'Transverse — all services', 'Transverse — all services', 'trans', array['ASJMT','ASJFR']::text[], 'own', 'tbc', 'Y', 'Flight planning, data distribution, operational control', 'Flight Ops', 'Cloud', 'Leon Software', 'confirmed', 'critical', 1, 'high', true, 'Classified critical — CSM review 22/07/2026
Dual-entity single point of failure for operational control
No local redundancy identified
Feeds Billing-pro → Sage (invoicing flow)
Contract holder to be confirmed', 'C. Clair / F. Sermarini'),
('ASJMT'::entity_code, 'webman', 'Webmanuals', 'Operational documentation', 'Transverse — all services', 'Transverse — all services', 'trans', array['ASJMT','ASJFR','GRP']::text[], 'grp', 'tbc', 'Y', 'Repository and editing of operational documentation (OM, MSM…)', 'All documentation', 'Cloud', 'Webmanuals (via CGSMT)', 'confirmed', 'critical', 1, 'high', true, 'Classified critical — CSM review 22/07/2026
“No option to have a local download, we have no control” (F. Sermarini)
Unavailability = loss of access to approved documentation
Contract held by the group: Part-IS boundary', 'C. Clair / F. Sermarini'),
('ASJFR'::entity_code, 'webman', 'Webmanuals', 'Operational documentation', 'Transverse — all services', 'Transverse — all services', 'trans', array['ASJMT','ASJFR','GRP']::text[], 'grp', 'tbc', 'Y', 'Repository and editing of operational documentation (OM, MSM…)', 'All documentation', 'Cloud', 'Webmanuals (via CGSMT)', 'confirmed', 'critical', 1, 'high', true, 'Classified critical — CSM review 22/07/2026
“No option to have a local download, we have no control” (F. Sermarini)
Unavailability = loss of access to approved documentation
Contract held by the group: Part-IS boundary', 'C. Clair / F. Sermarini'),
('ASJMT'::entity_code, 'spendesk', 'Spendesk', 'Supplier invoices', 'Transverse — all services', 'Transverse — all services', 'trans', array['ASJMT','ASJFR','ASFFR','GRP']::text[], 'grp', 'tbc', 'Y', 'Supplier invoices, accounting and payments', 'Financial', 'Cloud', 'Spendesk (via CGSMT)', 'confirmed', null, 2, 'medium', true, 'Classified transverse “concerns everyone” — CSM review 22/07/2026', 'F. Lescene / C. Clair'),
('ASJFR'::entity_code, 'spendesk', 'Spendesk', 'Supplier invoices', 'Transverse — all services', 'Transverse — all services', 'trans', array['ASJMT','ASJFR','ASFFR','GRP']::text[], 'grp', 'tbc', 'Y', 'Supplier invoices, accounting and payments', 'Financial', 'Cloud', 'Spendesk (via CGSMT)', 'confirmed', null, 2, 'medium', true, 'Classified transverse “concerns everyone” — CSM review 22/07/2026', 'F. Lescene / C. Clair'),
('ASFFR'::entity_code, 'spendesk', 'Spendesk', 'Supplier invoices', 'Transverse — all services', 'Transverse — all services', 'trans', array['ASJMT','ASJFR','ASFFR','GRP']::text[], 'grp', 'tbc', 'Y', 'Supplier invoices, accounting and payments', 'Financial', 'Cloud', 'Spendesk (via CGSMT)', 'confirmed', null, 2, 'medium', true, 'Classified transverse “concerns everyone” — CSM review 22/07/2026', 'F. Lescene / C. Clair'),
('ASJMT'::entity_code, 'cfoqa', 'CFOQA', 'FDM analysis', 'Flight Ops', 'Flight Ops', 'fo', array['ASJMT']::text[], 'own', 'ok', 'Y', 'FDM (Flight Data Monitoring) analysis — analysis service provider', 'Flight data (FDM)', 'Cloud', 'CFOQA', 'confirmed', null, 2, 'medium', true, 'Added by CSM on 22/07/2026 — AJD only
Contract held by AJD (confirmed by CSM 22/07/2026)
External provider processing flight data: IS.I.OR.235 interface to be covered (contract, event reporting)', 'G. Fournie (CSM)'),
('ASJMT'::entity_code, 'navdata', 'Navdata', 'Navigation databases FMS/EFB', 'Flight Ops', 'Flight Ops', 'fo', array['ASJMT','ASJFR']::text[], 'own', 'tbc', 'Y', 'Navigation databases — FMS / EFB updates', 'Navigation data', 'Cloud + onboard (FMS/EFB)', 'TBD (Jeppesen? Collins?)', 'to_confirm', 'critical', 1, 'high', true, 'Added by CSM on 22/07/2026
Moved to L1 (critical) — CSM decision 22/07/2026
Navigation data integrity: textbook Part-IS case (corruption = direct safety impact)
Provider, update cycle and entities to be clarified', 'G. Fournie (CSM)'),
('ASJFR'::entity_code, 'navdata', 'Navdata', 'Navigation databases FMS/EFB', 'Flight Ops', 'Flight Ops', 'fo', array['ASJMT','ASJFR']::text[], 'own', 'tbc', 'Y', 'Navigation databases — FMS / EFB updates', 'Navigation data', 'Cloud + onboard (FMS/EFB)', 'TBD (Jeppesen? Collins?)', 'to_confirm', 'critical', 1, 'high', true, 'Added by CSM on 22/07/2026
Moved to L1 (critical) — CSM decision 22/07/2026
Navigation data integrity: textbook Part-IS case (corruption = direct safety impact)
Provider, update cycle and entities to be clarified', 'G. Fournie (CSM)'),
('ASJFR'::entity_code, 'astonmed', 'Astonmedical.fr', 'Medical invoicing', 'Flight Ops', 'Flight Ops', 'fo', array['ASJFR']::text[], 'own', 'tbc', '?', 'Invoicing (medical) — exact scope to be confirmed', 'Invoicing / medical?', 'Cloud (web)', '?', 'to_confirm', null, 2, 'low', true, 'Assigned to Flight Ops ASJ — CSM decision 22/07/2026; invoicing use clarified
If medical data: high sensitivity (GDPR)', 'C. Clair / CSM'),
('ASJMT'::entity_code, 'trustflight', 'TrustFlight', 'Tech log & defects', 'Group CAMO', 'Group CAMO', 'camo', array['ASJMT']::text[], 'own', 'tbc', 'Y', 'Electronic tech log and defect tracking (aircraft logbook & defect log)', 'Maintenance, Flight Ops, Training', 'Cloud', 'TrustFlight', 'confirmed', 'critical', 1, 'high', true, 'Classified critical — CSM review 22/07/2026
Group CAMO: the AJD CAMO also serves ASJ
Trial period: contractual status and continuity to be clarified', 'F. Sermarini'),
('ASJMT'::entity_code, 'camp', 'CAMP', 'Airworthiness tracking', 'Group CAMO', 'Group CAMO', 'camo', array['ASJMT']::text[], 'own', 'ok', 'Y', 'Airworthiness monitoring', 'Maintenance / airworthiness', 'Cloud', 'CAMP Systems', 'confirmed', 'critical', 1, 'high', true, 'Classified critical — CSM review 22/07/2026
Group CAMO: listed under AJD, also covers the ASJ fleet (the ASJ annex refers to the AJD CAMO)
One contract per aircraft — considered held per AOC (confirmed by CSM 22/07/2026)', 'C. Clair / CSM'),
('ASJMT'::entity_code, 'oem', 'OEM portals', 'OEM technical documentation', 'Group CAMO', 'Group CAMO', 'camo', array['ASJMT']::text[], 'own', 'tbc', 'Y', 'Access to manufacturer and engine-maker technical documentation: Cessna (Textron), Dassault Falcon, Bombardier (SmartPubs + Flightdeck), Williams, Pratt & Whitney (RTX), Collins, GE Aerospace, Honeywell, Safran', 'Technical documentation / airworthiness', 'Cloud (third-party portals)', 'Multiple OEMs', 'confirmed', null, 2, 'medium', true, 'Added by CSM on 22/07/2026
URLs deliberately kept off the dashboard (CSM decision) — stored in the internal register
Integrity and availability of technical documentation = airworthiness stake; accounts and access rights to be inventoried', 'G. Fournie (CSM)'),
('ASJMT'::entity_code, 'arinc', 'ARINC / Ozone', 'Dispatch, perf, W&B', 'Ground Ops', 'Ground Ops', 'go', array['ASJMT']::text[], 'own', 'tbc', 'Y', 'Flight preparation, dispatch, performance, weight & balance', 'Flight Ops, Gnd Ops', 'Cloud', 'Collins (ARINC)', 'confirmed', 'critical', 1, 'high', true, 'Classified critical — CSM review 22/07/2026
Performance and W&B data: integrity directly linked to safety', 'F. Sermarini'),
('ASJMT'::entity_code, 'foreflight', 'ForeFlight', 'EFB — charts & briefing', 'Ground Ops', 'Ground Ops', 'go', array['ASJMT','ASJFR']::text[], 'own', 'tbc', 'Y', 'EFB — charts, navigation, briefing (exact scope to be confirmed)', 'Flight Ops', 'Cloud + local (EFB)', 'Boeing (ForeFlight)', 'to_confirm', 'critical', 1, 'high', true, 'Classified critical — CSM review 22/07/2026
Assigned to Ground Ops — CSM review 22/07/2026
Entity assignment and contract holder to be confirmed', 'R. Mahmoud'),
('ASJFR'::entity_code, 'foreflight', 'ForeFlight', 'EFB — charts & briefing', 'Ground Ops', 'Ground Ops', 'go', array['ASJMT','ASJFR']::text[], 'own', 'tbc', 'Y', 'EFB — charts, navigation, briefing (exact scope to be confirmed)', 'Flight Ops', 'Cloud + local (EFB)', 'Boeing (ForeFlight)', 'to_confirm', 'critical', 1, 'high', true, 'Classified critical — CSM review 22/07/2026
Assigned to Ground Ops — CSM review 22/07/2026
Entity assignment and contract holder to be confirmed', 'R. Mahmoud'),
('ASJMT'::entity_code, 'travelperk', 'Travel Perk', 'Crew travel', 'Ground Ops', 'Ground Ops', 'go', array['ASJMT','ASJFR']::text[], 'own', 'ok', 'N', 'Crew travel and hotel bookings', 'Crew travel', 'Cloud', 'TravelPerk', 'confirmed', null, 3, 'low', false, 'Assigned to Ground Ops (AJD · ASJ) — CSM decision 22/07/2026
Contract held by AJD (confirmed by CSM 22/07/2026)
Partial deployment (pending Finance requirements compliance)
Level 3 — lower risk (CSM decision 22/07/2026)', 'F. Sermarini'),
('ASJFR'::entity_code, 'travelperk', 'Travel Perk', 'Crew travel', 'Ground Ops', 'Ground Ops', 'go', array['ASJMT','ASJFR']::text[], 'grp', 'ok', 'N', 'Crew travel and hotel bookings', 'Crew travel', 'Cloud', 'TravelPerk', 'confirmed', null, 3, 'low', false, 'Assigned to Ground Ops (AJD · ASJ) — CSM decision 22/07/2026
Contract held by AJD (confirmed by CSM 22/07/2026)
Partial deployment (pending Finance requirements compliance)
Level 3 — lower risk (CSM decision 22/07/2026)', 'F. Sermarini'),
('ASJMT'::entity_code, 'scandlearn', 'Scandlearn', 'E-learning & IS training', 'Training', 'Training', 'training', array['ASJMT','ASJFR','ASFFR']::text[], 'own', 'tbc', 'N', 'E-learning for crews and staff — incl. Part-IS training (2 h, recurrent every 2 years)', 'Training records', 'Cloud', 'Scandlearn', 'confirmed', null, 2, 'low', false, 'Assigned to the Training department (AJD · ASJ) — CSM decision 22/07/2026
Supports the IS training requirement (IS.I.OR.240(g))
Contract holder (entity or group) to be confirmed', 'R. Mahmoud / MSM 5.2.5'),
('ASJFR'::entity_code, 'scandlearn', 'Scandlearn', 'E-learning & IS training', 'Training', 'Training', 'training', array['ASJMT','ASJFR','ASFFR']::text[], 'own', 'tbc', 'N', 'E-learning for crews and staff — incl. Part-IS training (2 h, recurrent every 2 years)', 'Training records', 'Cloud', 'Scandlearn', 'confirmed', null, 2, 'low', false, 'Assigned to the Training department (AJD · ASJ) — CSM decision 22/07/2026
Supports the IS training requirement (IS.I.OR.240(g))
Contract holder (entity or group) to be confirmed', 'R. Mahmoud / MSM 5.2.5'),
('ASFFR'::entity_code, 'scandlearn', 'Scandlearn', 'E-learning & IS training', 'Training', 'Training', 'training', array['ASJMT','ASJFR','ASFFR']::text[], 'own', 'tbc', 'N', 'E-learning for crews and staff — incl. Part-IS training (2 h, recurrent every 2 years)', 'Training records', 'Cloud', 'Scandlearn', 'confirmed', null, 2, 'low', false, 'Assigned to the Training department (AJD · ASJ) — CSM decision 22/07/2026
Supports the IS training requirement (IS.I.OR.240(g))
Contract holder (entity or group) to be confirmed', 'R. Mahmoud / MSM 5.2.5'),
('ASJFR'::entity_code, 'meteor', 'Meteor', 'DGAC occurrence reporting', 'CAA/EASA', 'CAA/EASA', 'caa', array['ASJFR']::text[], 'auth', 'tbc', 'Y', 'Regulatory reporting to the French authority — ASJ only', 'Occurrences / MOR', 'Cloud', 'DGAC (France)', 'confirmed', null, 2, 'medium', true, 'Assigned to CAA/EASA (ASJ) — CSM decision 22/07/2026
Official channel: availability required to meet the 72-hour deadline (IS.I.OR.230(c))', 'C. Clair'),
('ASJMT'::entity_code, 'centriktm', 'Centrik TM-CAD', 'TM-CAD occurrence reporting', 'CAA/EASA', 'CAA/EASA', 'caa', array['ASJMT']::text[], 'auth', 'tbc', 'Y', 'Occurrence submission portal to the Maltese authority (tmcad.centrik.net) — AJD only', 'Occurrences / MOR', 'Cloud', 'TrustFlight (Centrik) / TM-CAD', 'confirmed', null, 2, 'medium', true, 'Created in the CAA/EASA department (AJD) — CSM decision 22/07/2026
Official TM-CAD channel: availability required to meet the 72-hour deadline (IS.I.OR.230(c))
Depends on the Centrik platform (classified critical in transverse)', 'G. Fournie (CSM) / MSM AJD 3.3.1.7'),
('ASJMT'::entity_code, 'eccairs', 'ECCAIRS 2 (E2)', 'EU occurrence reporting', 'CAA/EASA', 'CAA/EASA', 'caa', array['ASJMT','ASJFR']::text[], 'auth', 'tbc', 'Y', 'European occurrence reporting portal (Reg (EU) 376/2014) — AJD and ASJ', 'Occurrences / MOR', 'Cloud', 'European Commission / EASA', 'confirmed', null, 2, 'medium', true, 'Created in the CAA/EASA department (AJD · ASJ) — CSM decision 22/07/2026
European regulatory channel — supports external IS reporting (IS.I.OR.230(a), Reg 376/2014)', 'G. Fournie (CSM)'),
('ASJFR'::entity_code, 'eccairs', 'ECCAIRS 2 (E2)', 'EU occurrence reporting', 'CAA/EASA', 'CAA/EASA', 'caa', array['ASJMT','ASJFR']::text[], 'auth', 'tbc', 'Y', 'European occurrence reporting portal (Reg (EU) 376/2014) — AJD and ASJ', 'Occurrences / MOR', 'Cloud', 'European Commission / EASA', 'confirmed', null, 2, 'medium', true, 'Created in the CAA/EASA department (AJD · ASJ) — CSM decision 22/07/2026
European regulatory channel — supports external IS reporting (IS.I.OR.230(a), Reg 376/2014)', 'G. Fournie (CSM)'),
('ASJFR'::entity_code, 'chorus', 'Chorus Pro', 'State invoicing', 'CAA/EASA', 'CAA/EASA', 'caa', array['ASJFR']::text[], 'auth', 'tbc', 'N', 'French State invoicing portal — invoicing of services to public entities (ASJ)', 'Invoicing / public procurement', 'Cloud', 'AIFE (French State)', 'confirmed', null, 2, 'low', false, 'Added by CSM on 22/07/2026 — ASJ only', 'G. Fournie (CSM)'),
('ASFFR'::entity_code, 'flightlogger', 'FlightLogger', 'Flight school management', 'Training (school)', 'Training (school)', 'asf', array['ASFFR']::text[], 'own', 'tbc', 'Y', 'School management: scheduling, student and instructor tracking, training records', 'Training / students', 'Cloud', 'FlightLogger', 'confirmed', 'serious', 2, 'medium', true, 'Core ATO system, cited as critical in the MSMs…
…but no Astonfly-specific Part-IS treatment in the ASJ MSM (ATO invisible in ch.7)', 'C. Clair / MSM'),
('ASFFR'::entity_code, 'salesforce', 'Salesforce', 'CRM — lead tracking', 'Commercial', 'Commercial', 'asf', array['ASFFR']::text[], 'own', 'tbc', 'N', 'CRM — lead follow-up (ASF only)', 'Prospects / clients', 'Cloud', 'Salesforce', 'confirmed', null, 2, 'low', false, 'Use clarified by CSM 22/07/2026: sales, lead follow-up', 'C. Clair / CSM'),
('ASFFR'::entity_code, 'agendize', 'Agendize', 'Appointment booking', 'Commercial', 'Commercial', 'asf', array['ASFFR']::text[], 'own', 'tbc', 'N', 'Appointment booking', 'Commercial', 'Cloud', 'Agendize', 'confirmed', null, 2, 'low', false, null, 'C. Clair'),
('ASFFR'::entity_code, 'connect', 'Connect Astonfly', 'Student portal', 'Training (school)', 'Training (school)', 'asf', array['ASFFR']::text[], 'own', 'tbc', '?', 'Student portal — scope to be confirmed', 'Students', 'Cloud', '?', 'to_confirm', null, 2, 'low', true, null, 'R. Mahmoud'),
('ASJMT'::entity_code, 'p1', 'CAMO / Maintenance?', 'Maintenance systems?', 'Group CAMO', 'Group CAMO', 'pending', array['ASJMT','ASJFR']::text[], null, null, '?', 'Partial reply — additional maintenance tools to be inventoried (besides CAMP, TrustFlight, OEM portals)', 'Maintenance', '?', '?', 'awaiting', 'serious', null, 'medium', true, 'Follow-up needed: high safety-impact domain', '—'),
('ASJFR'::entity_code, 'p1', 'CAMO / Maintenance?', 'Maintenance systems?', 'Group CAMO', 'Group CAMO', 'pending', array['ASJMT','ASJFR']::text[], null, null, '?', 'Partial reply — additional maintenance tools to be inventoried (besides CAMP, TrustFlight, OEM portals)', 'Maintenance', '?', '?', 'awaiting', 'serious', null, 'medium', true, 'Follow-up needed: high safety-impact domain', '—'),
('ASFFR'::entity_code, 'p2', 'Astonfly (management)?', 'School tools?', 'ATO', 'ATO', 'pending', array['ASFFR']::text[], null, null, '?', 'No reply from S. Hadid — school tools (simulators, instructor scheduling…) incomplete', 'Training', '?', '?', 'awaiting', 'serious', null, 'medium', true, 'Follow-up needed', '—'),
('ASJFR'::entity_code, 'p3', 'Ground Ops France?', 'Handling/dispatch tools?', 'Gnd Ops', 'Gnd Ops', 'pending', array['ASJFR']::text[], null, null, '?', 'No reply — French handling and dispatch tools not inventoried', 'Gnd Ops', '?', '?', 'awaiting', 'warning', null, 'low', true, 'Follow-up needed', '—'),
('ASJMT'::entity_code, 'p4', 'HR / Crew training?', 'Personnel files?', 'HR · Training', 'HR · Training', 'pending', array['ASJMT','ASJFR','ASFFR']::text[], null, null, '?', 'Partial reply — personnel files, licences, medicals: tools to be clarified', 'HR / licences', '?', '?', 'awaiting', 'warning', null, 'low', true, 'Follow-up needed', '—'),
('ASJFR'::entity_code, 'p4', 'HR / Crew training?', 'Personnel files?', 'HR · Training', 'HR · Training', 'pending', array['ASJMT','ASJFR','ASFFR']::text[], null, null, '?', 'Partial reply — personnel files, licences, medicals: tools to be clarified', 'HR / licences', '?', '?', 'awaiting', 'warning', null, 'low', true, 'Follow-up needed', '—'),
('ASFFR'::entity_code, 'p4', 'HR / Crew training?', 'Personnel files?', 'HR · Training', 'HR · Training', 'pending', array['ASJMT','ASJFR','ASFFR']::text[], null, null, '?', 'Partial reply — personnel files, licences, medicals: tools to be clarified', 'HR / licences', '?', '?', 'awaiting', 'warning', null, 'low', true, 'Follow-up needed', '—'),
('ASJMT'::entity_code, 'sam', 'S.A.M.', 'Compliance, safety, documents, ERP', 'Transverse', 'Transverse', 'trans', array['ASJMT','ASJFR','ASFFR','GRP']::text[], 'own', 'tbc', 'Y', 'Safety reports, findings, manuals, ERP activation log, Part-IS registers', 'Safety reports, occurrence data, manuals, personal data', 'Cloud EU (Vercel, Supabase; AWS migration planned)', 'Clair Group (in-house), Vercel, Supabase, Microsoft Entra ID', 'to_confirm', 'critical', 1, 'high', true, 'Added by S.A.M. on 10/11/2026: not in the Cartographie V7.1
Holds the ERP log and the crisis directory: fallback is the printed ERP binder', 'S.A.M.'),
('ASJFR'::entity_code, 'sam', 'S.A.M.', 'Compliance, safety, documents, ERP', 'Transverse', 'Transverse', 'trans', array['ASJMT','ASJFR','ASFFR','GRP']::text[], 'own', 'tbc', 'Y', 'Safety reports, findings, manuals, ERP activation log, Part-IS registers', 'Safety reports, occurrence data, manuals, personal data', 'Cloud EU (Vercel, Supabase; AWS migration planned)', 'Clair Group (in-house), Vercel, Supabase, Microsoft Entra ID', 'to_confirm', 'critical', 1, 'high', true, 'Added by S.A.M. on 10/11/2026: not in the Cartographie V7.1
Holds the ERP log and the crisis directory: fallback is the printed ERP binder', 'S.A.M.'),
('ASFFR'::entity_code, 'sam', 'S.A.M.', 'Compliance, safety, documents, ERP', 'Transverse', 'Transverse', 'trans', array['ASJMT','ASJFR','ASFFR','GRP']::text[], 'own', 'tbc', 'Y', 'Safety reports, findings, manuals, ERP activation log, Part-IS registers', 'Safety reports, occurrence data, manuals, personal data', 'Cloud EU (Vercel, Supabase; AWS migration planned)', 'Clair Group (in-house), Vercel, Supabase, Microsoft Entra ID', 'to_confirm', 'critical', 1, 'high', true, 'Added by S.A.M. on 10/11/2026: not in the Cartographie V7.1
Holds the ERP log and the crisis directory: fallback is the printed ERP binder', 'S.A.M.')
) as v(entity, ref, name, short, kind, dept, zone, scope, resp, contract, ops_impact, purpose, data, hosting, provider, status, attention, ring, criticality, safety_relevant, note, source)
where not exists (select 1 from is_systems s where s.entity = v.entity and s.ref = v.ref);

insert into is_flows (entity, from_system, to_system, data, means, criticality, note)
select v.* from (values
('ASJMT'::entity_code, 'Leon', 'Billing-pro', 'Invoices and flights', 'Interface', 'high', 'From the Cartographie V7.1 (22/07/2026)'),
('ASJFR'::entity_code, 'Leon', 'Billing-pro', 'Invoices and flights', 'Interface', 'high', 'From the Cartographie V7.1 (22/07/2026)'),
('ASJMT'::entity_code, 'Billing-pro', 'SAGE (suite ×6)', 'Accounting entries', 'Interface', 'medium', 'From the Cartographie V7.1 (22/07/2026)'),
('ASJFR'::entity_code, 'Billing-pro', 'SAGE (suite ×6)', 'Accounting entries', 'Interface', 'medium', 'From the Cartographie V7.1 (22/07/2026)'),
('ASFFR'::entity_code, 'Billing-pro', 'SAGE (suite ×6)', 'Accounting entries', 'Interface', 'medium', 'From the Cartographie V7.1 (22/07/2026)'),
('ASJMT'::entity_code, 'Centrik', 'Centrik TM-CAD', 'Safety and compliance data', 'Interface', 'high', 'From the Cartographie V7.1 (22/07/2026)')
) as v(entity, from_system, to_system, data, means, criticality, note)
where not exists (select 1 from is_flows f where f.entity = v.entity and f.from_system = v.from_system and f.to_system = v.to_system);
