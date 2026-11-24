-- NP-02 (24/11) · a change of nominated person asked with a notice shorter than the regulation: allowed, once the desk has been told
-- the legal notice and has written why (kept on the change and in the audit log).
alter table np_changes add column if not exists short_notice_reason text;

-- SIG-01 (24/11) · the handwritten signature of a person, as an image they upload themselves (private storage, path kept here).
-- S.A.M. places it only where that person has signed in S.A.M., on the documents that ask for a handwritten signature.
alter table people add column if not exists signature_path text;
alter table people add column if not exists signature_at timestamptz;
