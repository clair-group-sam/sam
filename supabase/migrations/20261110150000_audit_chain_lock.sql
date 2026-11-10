-- FB-085 · two inserts at the same moment could read the same previous hash and fork the chain.
-- A transaction-level advisory lock makes the chain strictly sequential (released at commit).
create or replace function audit_chain() returns trigger language plpgsql as $$
declare prev text;
begin
  perform pg_advisory_xact_lock(7426001);
  select hash into prev from audit_log order by id desc limit 1;
  new.prev_hash := prev;
  new.hash := encode(extensions.digest(coalesce(prev,'') || new.at::text || new.object_type || new.object_id || new.action || coalesce(new.after::text,''), 'sha256'), 'hex');
  return new;
end $$;
