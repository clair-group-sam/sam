-- REG-04 (26/11, Guillaume) · SERA, cited in the ASJMT manuals (OM-A…), followed in the Regulation menu like the other EARs.
insert into regulations (key, kind, title, short, number, page_url, entities, domains, sort) values
 ('sera','ear','Easy Access Rules for Standardised European Rules of the Air (SERA)','SERA','Implementing Regulation (EU) No 923/2012',
  'https://www.easa.europa.eu/en/document-library/easy-access-rules/easy-access-rules-standardised-european-rules-air-sera','{ASJMT,ASJFR,ASFFR}','{OPS,ATO}',38)
on conflict (key) do nothing;
