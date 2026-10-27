-- Centrik shows people as "<initials><Surname>, <Given> (<Department>)", e.g. "WDCWarnke Dherines, Christophe (Crew Training)".
-- Imported sign-offs and participants become "Christophe Warnke Dherines" with the department as role.
create or replace function pg_temp.centrik_person(n text) returns text[] language plpgsql immutable as $$
declare m text[]; sw int; gw int; sur text;
begin
  if n is null then return array[null, null]; end if;
  m := regexp_match(trim(n), '^([A-Z]+[^,]*),\s*([^(]+?)\s*(?:\((.*)\))?$');
  if m is null then return array[n, null]; end if;
  sw := array_length(regexp_split_to_array(trim(m[1]), '\s+'), 1);
  gw := array_length(regexp_split_to_array(trim(m[2]), '\s+'), 1);
  sur := substr(trim(m[1]), sw + gw + 1);
  if sur = '' or substr(trim(m[1]), 1, sw + gw) !~ '^[A-Z]+$' then return array[n, m[3]]; end if;
  return array[trim(m[2]) || ' ' || sur, m[3]];
end $$;

update risk_assessments
   set validated_role = coalesce(nullif(validated_role, ''), (pg_temp.centrik_person(validated_name))[2]),
       validated_name = (pg_temp.centrik_person(validated_name))[1]
 where source = 'centrik' and validated_name ~ '^[A-Z]{2,}[A-Z][a-z]';
update risk_assessments set validated_name = null where source = 'centrik' and validated_name = '-';

update risk_assessments ra
   set participants = (select coalesce(jsonb_agg(jsonb_build_object('name', (pg_temp.centrik_person(p->>'name'))[1], 'role', coalesce(nullif(p->>'role', ''), (pg_temp.centrik_person(p->>'name'))[2], ''))), '[]'::jsonb)
                         from jsonb_array_elements(ra.participants) p)
 where source = 'centrik' and jsonb_typeof(participants) = 'array' and participants::text ~ '"name": "[A-Z]{2,}[A-Z][a-z]';
