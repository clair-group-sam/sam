-- FB-039 · Report 2026-002 (AJD) was created from a Teams group chat and kept the WHOLE chat history in complements.teams_thread.
-- Only the messages telling the event belong there. The bot now keeps the event burst only (lib/teams-draft.ts, eventBurst).
-- Cleans every report that carries a full thread: the field is removed; the narrative and the journal are untouched.
update reports
   set complements = complements - 'teams_thread'
 where complements ? 'teams_thread';
-- check
select id, entity, headline, complements from reports where complements ? 'teams_thread' or complements ? 'teams_messages';
