-- PRJ-05 · who may use « Read the portals » beside the CMM and the deputy CMM: e-mail addresses, separated by commas.
insert into app_params (key, value, label, hint) values
  ('portal_readers', '', 'Portal readers (e-mails)', 'People allowed to read TMCAD / METEOR from S.A.M. beside the CMM and the deputy CMM. They need the S.A.M. Reader extension and their own portal session.')
on conflict (key) do nothing;
