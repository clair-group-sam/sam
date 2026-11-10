-- COMP (10/11) · Astontec, from the CAE FR.CAO.0058 Rev 05: the organisation review is the whole internal audit programme (§B.1 / §B.2, CAO.A.100 —
-- yearly, ≤ 12 months, full ASTDOC15 checklist); non-approved subcontractors are audited on site by the RRO (§B.7.3, ASTDOC20) ; approved maintenance
-- contractors (ASTDOC2) are reviewed through their contract at each organisation review (§B.3). Mirror of the manual, 10/11/2026 (RO 2025 found the list out of date).
insert into subcontractors (entity, code, name, service, domain, approval_ref, every_months, status_note, imported_from) values
 ('ASTFR','SUB-RBELL','R.BELL Aviation','Sellerie et aménagements intérieurs d’aéronefs (sous-traitant non agréé, sous couvert de FR.CAO.0058)','CAE',null,12,'Audit sur site par le RRO avant habilitation puis surveillance ASTDOC20 (CAE §B.7.3)','CAE Rev 05 §E.2 ASTDOC12'),
 ('ASTFR','SUB-AEROSTYLL','Aerostyll','Peinture avions et sous-ensembles (sous-traitant non agréé, sous couvert de FR.CAO.0058)','CAE',null,12,'Ajouté à ASTDOC12 à la suite de la RO 2025 ; audit sur site ASTDOC20 (CAE §B.7.3)','CAE Rev 05 §E.2 ASTDOC12'),
 ('ASTFR','CTR-EAME','Étampes Aéro Maintenance Europe (EAME)','Contractant maintenance agréé — revue de contrat à la RO (CAE §B.3)','CAE','FR.CAO.0080',12,'Revue du contrat de maintenance à chaque revue d’organisation','CAE Rev 05 §E.3 ASTDOC2'),
 ('ASTFR','CTR-IPCO','Instruments de Précision de la Côte Ouest (IPCO)','Contractant maintenance agréé — revue de contrat à la RO (CAE §B.3)','CAE','FR.145.0541',12,null,'CAE Rev 05 §E.3 ASTDOC2'),
 ('ASTFR','CTR-LAMBERT','Lambert Aircraft Engineering','Contractant maintenance agréé — revue de contrat à la RO (CAE §B.3)','CAE','BE.145.44',12,null,'CAE Rev 05 §E.3 ASTDOC2'),
 ('ASTFR','CTR-RECTIMO','Rectimo Aviation','Contractant maintenance agréé — revue de contrat à la RO (CAE §B.3)','CAE','FR.145.0156',12,null,'CAE Rev 05 §E.3 ASTDOC2'),
 ('ASTFR','CTR-AFM','Aéro Flandre Maintenance','Contractant maintenance agréé — revue de contrat à la RO (CAE §B.3)','CAE','FR.CAO.0079',12,null,'CAE Rev 05 §E.3 ASTDOC2'),
 ('ASTFR','CTR-AEROWOOD','Aerowood','Contractant maintenance agréé — revue de contrat à la RO (CAE §B.3)','CAE','FR.CAO.0051',12,null,'CAE Rev 05 §E.3 ASTDOC2'),
 ('ASTFR','CTR-AEROSMITH','Aerosmith 66','Contractant maintenance agréé — revue de contrat à la RO (CAE §B.3)','CAE','FR.145.0712',12,null,'CAE Rev 05 §E.3 ASTDOC2'),
 ('ASTFR','CTR-AIRSERVICES','Airservices-France','Contractant maintenance agréé — revue de contrat à la RO (CAE §B.3)','CAE','FR.CAO.0089',12,null,'CAE Rev 05 §E.3 ASTDOC2'),
 ('ASTFR','CTR-AVIONIQUE','Avionique Services','Contractant maintenance agréé — revue de contrat à la RO (CAE §B.3)','CAE','FR.CAO.0084',12,null,'CAE Rev 05 §E.3 ASTDOC2'),
 ('ASTFR','CTR-YBAERO','Y.B Aéro','Contractant maintenance agréé — revue de contrat à la RO (CAE §B.3)','CAE','FR.CAO.0188',12,null,'CAE Rev 05 §E.3 ASTDOC2'),
 ('ASTFR','CTR-MATAERO','M.A.T Aéro','Contractant maintenance agréé — revue de contrat à la RO (CAE §B.3)','CAE','FR.CAO.0141',12,null,'CAE Rev 05 §E.3 ASTDOC2'),
 ('ASTFR','CTR-PAM','Pontoise Aéro Maintenance','Contractant maintenance agréé — revue de contrat à la RO (CAE §B.3)','CAE','FR.CAO.0082',12,null,'CAE Rev 05 §E.3 ASTDOC2')
on conflict do nothing;

-- the recurring checks the CAE asks for between two organisation reviews
insert into compliance_checks (entity, code, title, reference, domain, every_months, owner_role, note) values
 ('ASTFR','CTR-01','Revue des contrats de maintenance avec les contractants agréés (ASTDOC2)','CAE §B.3 · CAO.A.100(b)(2)','CAE',12,'MAM','Bilan du respect de chaque contrat de maintenance, fait lors de la revue d’organisation'),
 ('ASTFR','CTR-02','Liste des sous-traitants et contractants à jour (ASTDOC12 / ASTDOC2), agréments archivés','CAE §B.7 · CAO.A.095','CAE',6,'MAM','Écart RO 2025 : liste non à jour'),
 ('ASTFR','CTR-03','Revue annuelle des programmes d’entretien (PE) par type','CAE §D.3','CAE',12,'MAM','Écart RO 2025 : revues annuelles B58 / CAP10 / DA40 dépassées'),
 ('ASTFR','CTR-04','Outillage : fiches nominatives ASTDOC16 et étalonnage dans les délais (doc constructeur ou 2 ans)','CAE §C.3.8','CAE',6,'MAM','Écarts RO 2025'),
 ('ASTFR','CTR-05','Dossiers de formation et competency assessments du personnel','CAE §B.4','CAE',12,'MAM','Écarts RO 2025')
on conflict do nothing;
