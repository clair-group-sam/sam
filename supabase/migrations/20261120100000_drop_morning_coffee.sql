-- Morning coffee removed (20/11/2026, Guillaume): it doubled the Inbox, the landing screens and the Teams cards, and it was the
-- only reason S.A.M. held personal Microsoft tokens (mail, calendar, chats). Its tables go with it: the daily recaps, the ranking
-- preferences and the encrypted refresh tokens.
drop table if exists coffee_recaps;
drop table if exists coffee_prefs;
drop table if exists graph_tokens;
