-- ECC-01 fix · the taxonomy API gives minInstance / maxInstance as words ("Optional", "Single value"), not numbers
alter table eccairs_attributes alter column min_instance type text using min_instance::text;
alter table eccairs_attributes alter column max_instance type text using max_instance::text;
