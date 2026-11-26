-- REG-05 (26/11, Guillaume) · cadence of the watch from the MSMs: AJD MSM 1.6.4 "twice-monthly external monitoring", ASJ MSM 1.5.4 and
-- ASF MSM 1.5.2 "bi-monthly external monitoring" (read as twice a month, like AJD). Every watch stream is due every 15 days.
-- Reminders go to the Compliance department (CMM), 3 days before the due date; S.A.M. never runs a watch round on its own.
update watch_topics set every_days = 15 where active;
