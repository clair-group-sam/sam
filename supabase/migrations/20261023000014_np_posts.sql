-- NP management: posts of each entity (holder, deputy, reporting line, authority acceptance). Source of the organisation
-- charts drawn by S.A.M.; manuals keep a snapshot of the chart per revision.
create table if not exists np_posts (
  id uuid primary key default gen_random_uuid(),
  entity entity_code not null references entities(code),
  code text not null,                     -- AM, RE, RN, RRO, NPFO… (unique in the entity)
  title text not null,                    -- as written in the manuals, e.g. "Responsable Entretien"
  parent_code text,                       -- reports to (code of another post of the entity)
  ord int not null default 0,
  holder_name text, holder_person uuid references people(id),
  deputy_name text, deputy_person uuid references people(id),
  status text not null default 'accepted', -- accepted | pending | not_required
  since date,
  regulatory text,                        -- e.g. CAO.A.035
  updated_at timestamptz default now(), updated_by uuid references people(id),
  unique (entity, code)
);
alter table np_posts enable row level security;
drop policy if exists np_posts_scope on np_posts;
create policy np_posts_scope on np_posts for select to authenticated using (entity = any(my_entities()));

-- Astontec, as shown in the CAE (Iss 1 Rev 05, A.8 Organigramme)
insert into np_posts (entity, code, title, parent_code, ord, holder_name, deputy_name, status, regulatory) values
 ('TEC','AM','Dirigeant Responsable',null,1,'Charles CLAIR',null,'accepted','CAO.A.035'),
 ('TEC','RE','Responsable Entretien','AM',2,'Jonathan WOLSKI','Cassandra NIOT','accepted','CAO.A.035'),
 ('TEC','RN','Responsable Navigabilité','AM',3,'Florian DELUBAC','Jonathan WOLSKI','accepted','CAO.A.035'),
 ('TEC','RRO','Responsable de Revue d''Organisation','AM',4,'Guillaume FOURNIE',null,'accepted','CAO.A.035')
on conflict (entity, code) do nothing;

-- the chart lost at import, restored in CAE A.8 (published Rev 05 and the Rev 06 draft) as a S.A.M. chart block
update revision_sections s set body = jsonb_set(s.body, '{base_html}', to_jsonb(coalesce(s.body->>'base_html','') || '<div data-sam-orgchart="TEC" data-snapshot="{&quot;entity&quot;:&quot;TEC&quot;,&quot;at&quot;:&quot;2026-01-19&quot;,&quot;source&quot;:&quot;Web Manuals · CAE Iss 1 Rev 05 · A.8&quot;,&quot;deputyLabel&quot;:&quot;Adjoint &amp; Suppléant&quot;,&quot;posts&quot;:[{&quot;code&quot;:&quot;AM&quot;,&quot;title&quot;:&quot;Dirigeant Responsable&quot;,&quot;holder&quot;:&quot;Charles CLAIR&quot;,&quot;deputy&quot;:null,&quot;parent&quot;:null},{&quot;code&quot;:&quot;RE&quot;,&quot;title&quot;:&quot;Responsable Entretien&quot;,&quot;holder&quot;:&quot;Jonathan WOLSKI&quot;,&quot;deputy&quot;:&quot;Cassandra NIOT&quot;,&quot;parent&quot;:&quot;AM&quot;},{&quot;code&quot;:&quot;RN&quot;,&quot;title&quot;:&quot;Responsable Navigabilité&quot;,&quot;holder&quot;:&quot;Florian DELUBAC&quot;,&quot;deputy&quot;:&quot;Jonathan WOLSKI&quot;,&quot;parent&quot;:&quot;AM&quot;},{&quot;code&quot;:&quot;RRO&quot;,&quot;title&quot;:&quot;Responsable de Revue d''Organisation&quot;,&quot;holder&quot;:&quot;Guillaume FOURNIE&quot;,&quot;deputy&quot;:null,&quot;parent&quot;:&quot;AM&quot;}]}"></div>'))
from revisions r join manuals m on m.id = r.manual_id
where s.revision_id = r.id and m.entity = 'TEC' and m.code = 'CAE' and r.rev in ('05','06') and s.ref = 'A.8'
  and s.body ? 'base_html' and coalesce(s.body->>'base_html','') not like '%data-sam-orgchart%';
update revision_sections s set body = jsonb_set(s.body, '{html}', to_jsonb(coalesce(s.body->>'html','') || '<div data-sam-orgchart="TEC" data-snapshot="{&quot;entity&quot;:&quot;TEC&quot;,&quot;at&quot;:&quot;2026-01-19&quot;,&quot;source&quot;:&quot;Web Manuals · CAE Iss 1 Rev 05 · A.8&quot;,&quot;deputyLabel&quot;:&quot;Adjoint &amp; Suppléant&quot;,&quot;posts&quot;:[{&quot;code&quot;:&quot;AM&quot;,&quot;title&quot;:&quot;Dirigeant Responsable&quot;,&quot;holder&quot;:&quot;Charles CLAIR&quot;,&quot;deputy&quot;:null,&quot;parent&quot;:null},{&quot;code&quot;:&quot;RE&quot;,&quot;title&quot;:&quot;Responsable Entretien&quot;,&quot;holder&quot;:&quot;Jonathan WOLSKI&quot;,&quot;deputy&quot;:&quot;Cassandra NIOT&quot;,&quot;parent&quot;:&quot;AM&quot;},{&quot;code&quot;:&quot;RN&quot;,&quot;title&quot;:&quot;Responsable Navigabilité&quot;,&quot;holder&quot;:&quot;Florian DELUBAC&quot;,&quot;deputy&quot;:&quot;Jonathan WOLSKI&quot;,&quot;parent&quot;:&quot;AM&quot;},{&quot;code&quot;:&quot;RRO&quot;,&quot;title&quot;:&quot;Responsable de Revue d''Organisation&quot;,&quot;holder&quot;:&quot;Guillaume FOURNIE&quot;,&quot;deputy&quot;:null,&quot;parent&quot;:&quot;AM&quot;}]}"></div>'))
from revisions r join manuals m on m.id = r.manual_id
where s.revision_id = r.id and m.entity = 'TEC' and m.code = 'CAE' and r.rev in ('05','06') and s.ref = 'A.8'
  and coalesce(s.body->>'html','') not like '%data-sam-orgchart%';
