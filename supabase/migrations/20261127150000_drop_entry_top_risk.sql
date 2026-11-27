-- SAF (27/11, Guillaume) · the "Top risk" mark of an entry is removed: in Centrik it only said that the entry belonged to the
-- hazard log. S.A.M. designates top hazards on the hazard itself (hazards.top_risk), and the import reads the Centrik field only
-- to sort an entry into the hazard log.
alter table risk_assessments drop column if exists top_risk;
