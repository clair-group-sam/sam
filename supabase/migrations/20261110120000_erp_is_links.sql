-- Part-IS and ERP links (10/11/2026): an IS risk points to its system, a system to its contract in the Subcontractors register,
-- an ERP activation keeps the Teams crisis chat S.A.M. opened for it.
alter table is_risks add column if not exists system_id uuid references is_systems(id) on delete set null;
create index if not exists is_risks_system on is_risks (system_id);
alter table is_systems add column if not exists subcontractor_id uuid references subcontractors(id) on delete set null;
alter table erp_activations add column if not exists teams_chat_id text;
alter table erp_activations add column if not exists teams_chat_url text;

-- risks written before the link: matched on the system name of the same entity
update is_risks r set system_id = s.id
from is_systems s
where r.system_id is null and r.system is not null and s.entity = r.entity and s.active
  and lower(r.system) like lower(split_part(s.name, ' ', 1)) || '%' and length(split_part(s.name, ' ', 1)) >= 4;

-- systems whose provider is already a subcontractor of the same entity: first word of the name, at least 4 letters, generic words excluded
update is_systems s set subcontractor_id = c.id
from subcontractors c
where s.subcontractor_id is null and s.resp is distinct from 'auth' and c.entity = s.entity and c.active
  and length(split_part(s.name, ' ', 1)) >= 4
  and lower(split_part(regexp_replace(s.name, '[^A-Za-z0-9 ]', ' ', 'g'), ' ', 1)) not in ('websites','travel','group','connect','microsoft')
  and lower(c.name) like lower(split_part(regexp_replace(s.name, '[^A-Za-z0-9 ]', ' ', 'g'), ' ', 1)) || '%';
