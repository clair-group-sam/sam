-- COMP (06/11) · Astonfly: findings imported from Monday keep their origin; subcontractors of ENR-ATO-01 Ed2 Rev4; recurring checks CC-xx (MSM §2.1).
alter table findings add column if not exists imported_from text;
alter table audits add column if not exists external_ref text;              -- authority inspection number (#345960, 0015-3885)

insert into subcontractors (entity, code, name, service, domain, approval_ref, every_months, imported_from) values
 ('ASFFR','SUB-SKY4U','Sky4U','MCC training (TM F1 §F1.11)','ATO','AT.ATO.164',24,'ENR-ATO-01 Ed2 Rev4'),
 ('ASFFR','SUB-AFA','AFA — Airline Flight Academy','MCC training (TM F1 §F1.11)','ATO','IE.ATO.005',24,'ENR-ATO-01 Ed2 Rev4'),
 ('ASFFR','SUB-PADPILOT','Pad Pilot','ATPL theoretical training supports','ATO',null,24,'ENR-ATO-01 Ed2 Rev4'),
 ('ASFFR','SUB-EVIONICA','Evionica','UPRT theoretical course (e-learning)','ATO',null,24,'ENR-ATO-01 Ed2 Rev4')
on conflict do nothing;

insert into compliance_checks (entity, code, title, reference, domain, every_months, owner_role) values
 ('ASFFR','CC-01','Facilities and flight preparation room — LFPN','ORA.ATO.140','ATO',6,'CMM'),
 ('ASFFR','CC-03','Observation of a flight training session','ORA.ATO.125','ATO',3,'HT'),
 ('ASFFR','CC-05','Student files sampling','ORA.ATO.120','ATO',3,'CMM'),
 ('ASFFR','CC-06','Instructor files: qualifications, standardisation, SMS training','ORA.ATO.110','ATO',6,'HT'),
 ('ASFFR','CC-07','Web Manuals / METEOR consistency','ORA.GEN.115','ATO',3,'CMM'),
 ('ASFFR','CC-08','ERP sheets and emergency numbers in aircraft kits','AMC1 ORA.GEN.200(a)(3)','ATO',6,'SM'),
 ('ASFFR','CC-10','Regulatory watch: impact analysis ≤ 30 days','ORA.GEN.155','ATO',1,'CMM'),
 ('ASFFR','CC-11','Theoretical subcontractors updates checked against the TM','ORA.GEN.205','ATO',3,'CTKI'),
 ('ASFFR','CC-13','MEL: CS-GEN-MMEL watch, MEL updated ≤ 90 days','NCO.GEN.155','ATO',6,'CFI'),
 ('ASFFR','CC-14','Occurrences: notification ≤ 72 h, analysis, closure','ORA.GEN.160','ATO',1,'SM'),
 ('ASFFR','CC-15','CODIR held with SRB agenda, minutes archived','AMC1 ORA.GEN.200(a)(1)','ATO',1,'CMM'),
 ('ASFFR','CC-16','Subcontractor contracts with access clause','ORA.GEN.205 · ORA.GEN.140','ATO',12,'CMM')
on conflict do nothing;
