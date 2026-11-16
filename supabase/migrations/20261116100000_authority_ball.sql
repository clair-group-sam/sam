-- PRJ-04 · CAA applications: whose turn it is, the next task in one line, the authority's assessor, what the portal says (16/11).
-- "ball" is deduced from the stage (submitted = the authority's, everything else open = ours); ball_override is the desk's word when
-- the portal says otherwise (TM-CAD "Requires Info" while we still show submitted, or an "Assessing" file that waits on our reply).
alter table authority_files add column if not exists ball_override text check (ball_override in ('us','authority'));
alter table authority_files add column if not exists next_task text;          -- "Send the O&M procedures" — one line, replaces the stage's default wording
alter table authority_files add column if not exists next_owner text;         -- who does it (post or name)
alter table authority_files add column if not exists assessor text;           -- the authority's agent on the file
alter table authority_files add column if not exists portal_status text;      -- the status as the portal words it: Assessing, Requires Info, Ouvert…
alter table authority_files add column if not exists portal_read_on date;     -- when the portal was last read for this file
alter table authority_files add column if not exists last_exchange text;      -- the last exchange in one line (mirror of the portal or of the last round)
alter table authority_files add column if not exists last_exchange_on date;
-- the same on a finding notified by an authority: the portal's wording and when it was last read
alter table findings add column if not exists portal_status text;
alter table findings add column if not exists portal_read_on date;
