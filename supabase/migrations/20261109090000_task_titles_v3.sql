-- DA v3 (Hallmark, 06/11/2026): open tasks created before the new title format.
-- "Verb phrase — <file>" becomes "<file>: verb phrase"; "Overdue N days — <task>" becomes "<task>: overdue N days".
-- Only open tasks; closed ones keep their history as written.
do $$
declare v text;
begin
  foreach v in array array['Prepare the dossier','Compliance check','Signatures','Submit','Follow up','Answer the remarks','Integrate and publish','File the certificate','Close-out','Correct the dossier after remarks'] loop
    update public.tasks
       set title = substring(title from length(v) + 4) || ': ' || lower(left(v, 1)) || substring(v from 2)
     where status = 'open' and title like v || ' — %';
  end loop;
end $$;

update public.tasks
   set title = regexp_replace(title, '^Overdue (\d+) days — (.*)$', '\2: overdue \1 days')
 where status = 'open' and kind = 'escalation' and title ~ '^Overdue \d+ days — ';
