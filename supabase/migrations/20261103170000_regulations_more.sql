-- REG-02 · texts cited by the Astontec CAE manual, added to the Regulation menu (Guillaume, 03/11). Links and version are read at the next check.
insert into regulations (key, kind, title, short, number, page_url, entities, domains, sort) values
 ('initial-airworthiness','ear','Easy Access Rules for Initial Airworthiness and Environmental Protection (Part-21)','Initial Airworthiness (Part-21)','Regulation (EU) No 748/2012',
  'https://www.easa.europa.eu/en/document-library/easy-access-rules/easy-access-rules-initial-airworthiness-and-environmental','{ASTFR,ASJMT}','{CAE,CAMO}',35),
 ('cs-mmel','ear','Easy Access Rules for Master Minimum Equipment List (CS-MMEL)','CS-MMEL','CS-MMEL',
  'https://www.easa.europa.eu/en/document-library/easy-access-rules/easy-access-rules-master-minimum-equipment-list-cs-mmel','{ASJMT,ASJFR,ASTFR}','{OPS,CAMO}',36),
 ('cs-gen-mmel','ear','Easy Access Rules for Generic Master Minimum Equipment List (CS-GEN-MMEL)','CS-GEN-MMEL','CS-GEN-MMEL',
  'https://www.easa.europa.eu/en/document-library/easy-access-rules/easy-access-rules-generic-master-minimum-equipment-list-cs-gen-mmel','{ASJMT,ASJFR}','{OPS}',37),
 ('occurrence-classification','other','Classification of occurrences in civil aviation to be mandatorily reported','Occurrence classification','Implementing Regulation (EU) 2015/1018',
  'https://eur-lex.europa.eu/eli/reg_impl/2015/1018/oj','{ASJMT,ASJFR,ASFFR,ASTFR}','{SAFETY}',65)
on conflict (key) do nothing;
