-- Certificates & Validities: documents are filed in folders (proposed by SAM at drop time, changeable afterwards).
alter table certificates add column if not exists folder text;   -- e.g. "Approvals & validities", "Insurance", "Aircraft › F-HXXX"
update certificates set folder = case when scope = 'aircraft' then 'Aircraft' || coalesce(' › ' || registration, '') when kind = 'insurance' then 'Insurance' else 'Approvals & validities' end where folder is null;
