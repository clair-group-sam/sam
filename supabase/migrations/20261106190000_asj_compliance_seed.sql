-- COMP (06/11) · Astonjet SAS (FR AOC): contracted activities and recurring checks of ENR-OPS-01 Ed.01 Rev.04 (14/04/2026).
insert into subcontractors (entity, code, name, service, domain, every_months, imported_from) values
 ('ASJFR','FSTD 1','Flight Safety','Type rating / recurrent training (external FSTD provider)','OPS',12,'ENR-OPS-01 Ed.01 Rev.04'),
 ('ASJFR','FSTD 2','Aviomar','Training (ATO)','OPS',12,'ENR-OPS-01 Ed.01 Rev.04'),
 ('ASJFR','FSTD 3','DV Motion','Training (FSTD)','OPS',24,'ENR-OPS-01 Ed.01 Rev.04'),
 ('ASJFR','LEON','Leon','Flight planning / scheduling software','OPS',24,'ENR-OPS-01 Ed.01 Rev.04'),
 ('ASJFR','D.2.1.1.6.1.4','Mermoz','ESET training (ATO) — contracted activity D.2.1.1.6.1.4','OPS',24,'ENR-OPS-01 Ed.01 Rev.04')
on conflict do nothing;

insert into compliance_checks (entity, code, title, reference, domain, every_months, owner_role) values
 ('ASJFR','C1','Flight package (min 5 checks per audit)','ORO.GEN.200(a)(6) · CAT.OP.MPA','OPS',6,'CMM'),
 ('ASJFR','C2','ARINC (perf & W&B)','CAT.POL.A · CAT.POL.MAB.100','OPS',6,'CMM'),
 ('ASJFR','C3','Aircraft library','CAT.GEN.MPA.180 · ORO.MLR.100','OPS',6,'CMM')
on conflict do nothing;

-- the subcontractor audits of the 2026-2027 plan point to their row
update audits a set subcontractor_id = s.id from subcontractors s
 where a.entity = 'ASJFR' and s.entity = 'ASJFR' and a.subcontractor_id is null and a.kind = 'subcontractor'
   and lower(coalesce(a.subcontractor, a.title)) like '%' || lower(s.name) || '%';
update audit_modules m set subcontractor_id = s.id from subcontractors s, audit_programmes p
 where m.programme_id = p.id and p.entity = 'ASJFR' and s.entity = 'ASJFR' and m.subcontractor_id is null and m.kind = 'subcontractor'
   and lower(m.title) like '%' || lower(s.name) || '%';
