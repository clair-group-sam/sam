-- SOC-02 · one reminder / escalation engine for everything with a due date in the Inbox.
-- Rules per task kind ('*' = default). Days are counted after the due date: remind (0 = the due date), chase, escalate to the
-- department head (CMM for compliance kinds, SM for safety kinds), then to the AM. null = that step never happens.
create table if not exists notification_rules (
  kind text primary key,
  label text not null,
  remind_days int,
  chase_days int,
  escalate_days int,
  escalate_to text,                 -- CMM | SM
  am_days int,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table notification_rules enable row level security;
drop policy if exists notification_rules_read on notification_rules;
create policy notification_rules_read on notification_rules for select using (true);

insert into notification_rules (kind, label, remind_days, chase_days, escalate_days, escalate_to, am_days) values
  ('*',                    'Default (any other task)',        0, 3, 7,  'CMM', 15),
  ('reading',              'Read & acknowledge',              0, 7, 14, 'CMM', null),
  ('signature',            'Signature',                       0, 2, 5,  'CMM', 10),
  ('authority',            'CAA application step',            0, 3, 7,  'CMM', 15),
  ('authority_followup',   'Authority follow-up',             0, 7, 14, 'CMM', null),
  ('certificate_validity', 'Certificate / validity',          0, 3, 7,  'CMM', 15),
  ('finding',              'Finding answer',                  0, 3, 7,  'CMM', 15),
  ('project',              'Project task',                    0, 3, 7,  'CMM', 15),
  ('action',               'Safety action',                   0, 3, 7,  'SM',  15),
  ('action_verify',        'Verify a safety action',          0, 3, 7,  'SM',  null),
  ('action_effectiveness', 'Effectiveness check',             0, 7, 14, 'SM',  null),
  ('mitigation',           'Mitigation',                      0, 3, 7,  'SM',  15),
  ('risk_review',          'Risk review',                     0, 7, 14, 'SM',  30),
  ('safety_report',        'Safety report to treat',          0, 2, 5,  'SM',  10),
  ('safety_question',      'Question on a report',            0, 3, 7,  'SM',  null)
on conflict (kind) do nothing;

-- what the engine already did for a task: {"remind":"2026-10-30","chase":…,"escalate":…,"am":…}
alter table tasks add column if not exists escalation jsonb;
create index if not exists tasks_open_due on tasks (due) where status = 'open';
