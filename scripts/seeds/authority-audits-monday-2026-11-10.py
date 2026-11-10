#!/usr/bin/env python3
"""Builds supabase/migrations/20261110210000_authority_audits.sql from the Monday « Compliance Software » board
(CIVIL AVIATION AUDIT group, read 10/11/2026): what the authority really shares for each audit and finding."""
import sys

M = "https://clair-group-team.monday.com/protected_static/5463743/resources/"
audits = [  # number, report received on, closed on, report files
    ("#267540", "2024-09-23", "2024-12-16", ["2455478267/rapport_267540.pdf"]),
    ("#174635", "2025-03-13", "2025-03-13", ["2455527091/Rapport%20de%CC%81valuation%202025%20FR-3124.pdf", "2455527359/Rapport%20de%CC%81valuation%202025%20FR-3121.pdf"]),
    ("#174637", "2025-03-13", "2025-03-17", ["2455529914/Rapport%20de%CC%81valuation%202025%20FR-3122.pdf", "2455534177/Rapport%20de%CC%81valuation%202025%20FR-3125.pdf"]),
    ("#206920", "2025-07-10", "2025-10-06", ["2464956914/2025032526-%20Rapport%20Audit%20FR.ATO.0036%20ASTONFLY%20-Acte_206920.pdf"]),
    ("#330880", "2025-10-17", "2025-12-19", ["2502593674/rapport_330880.pdf"]),
    ("0015-3885", "2025-11-07", "2025-11-07", ["2543109742/CRISAuditReport%20(2).doc"]),
    ("0015-3886", "2025-11-20", "2025-11-20", ["2570122171/CRISAuditReport%20(4).doc", "2570122371/CRISAuditReport%20(3).doc"]),
    ("#339220", "2025-08-28", "2025-08-28", ["3276224280/20250826-%20Audit%20site%20suppl%C3%A9mentaire%20Le%20CASTELLET-%20FR.ATO.0036%20ASTONFLY%20-Rapport_Acte_339220.pdf"]),
    ("#368880", "2025-11-19", "2025-12-19", ["3276224231/20251119-%20R%C3%A9union%20avec%20le%20DR%20-%20FR.ATO.0036-%20Rapport_Acte_368880.pdf"]),
    ("#345960", "2026-10-08", None, []),
    ("#368860", "2026-11-04", "2026-11-04", []),
    ("#430960", None, None, []),
]
A = {"Yes": "yes", "No": "no", "Awaiting": "awaiting", "NA": "na", "Fait": "yes", "Bloqué": "no", None: None}
# subitem id, authority ref, root cause accepted?, plan accepted?, proof accepted?, proof of implementation, closed on, reason / note, finding file, monday status
findings = [
    ("18083584071", "#1047980", "Yes", "Yes", "Fait", "Oui, voir comptes rendus CODIR", "2024-12-16", None, "3277399074/%231047980.docx", "Closed"),
    ("18083584458", "#1047900", "Yes", "Yes", "Fait", "Voir audit plan 2023-2025 et 2025-2027", "2024-12-16", None, "3277398398/%231047900.docx", "Closed"),
    ("18083686916", "#1047920", "Yes", "Yes", "Fait", "Attestation de conformité à la norme de certification jointe aux dossiers d'extension de validité FSTD réalisés.", "2024-12-16", "Observation DSAC (audit annuel FSTD #267540) classée / non suivie dans METEOR, aucune réponse attendue de l'organisme. Réponse tracée dans Monday : point déjà pris en compte lors de la réalisation des dossiers.", "3277398804/%231047920.docx", "Closed"),
    ("18083750461", "#174637-B", "NA", "NA", "NA", "Remarque DSAC B de l'évaluation récurrente 2025 FR-3122 / FR-3125 (AL250-19), notifiée le 13/03/2025 : effets de la panne Weather Radar non perceptibles. Remarque lue et analysée le 17/03/2025 par le FSTD Manager ; décision de ne pas y donner suite (remarque non contraignante, sans incidence sur la qualification du FSTD).", "2025-03-17", "Remarque (R) : l'organisme n'est pas tenu de la mettre en œuvre. Accusée le 17/03/2025 et non retenue après analyse – décision FSTD Manager, validée CMM.", "3277405704/%23174637-B.docx", "Closed"),
    ("18083758921", "#174637-A", "Yes", "Yes", "Fait", "Réponse du FSTD Manager (O. Chirpaz) à la DSAC après réception du rapport d'évaluation AL250-19 (FR-3122 / FR-3125, notifié le 13/03/2025) : vérification sur le QTG Player, nouvelle exportation normale, pas de rejeu nécessaire, question transmise à ALSIM.", "2025-03-17", None, "3277405022/%23174637-A.docx", "Closed"),
    ("9591909332", "#1191500", "Yes", "Yes", "Fait", "Fiche d'urgence ASF-ERP Rev1 (2025) : numero d'urgence aeronautique 191 en priorite, numeros BGTA, BEA et DNPAF, procedure en cas de probleme en escale (document 'PROCEDURE EN CAS DE PROBLEME EN ESCALE' joint). Voir Rev1.", "2025-07-29", "Données METEOR (constatation #1191500) : niveau 2, notifiée le 10/07/2025, clôturée par la DSAC le 29/07/2025. Analyse des causes déposée le 29/07/2025 (G. Fournié) ; action corrective mise en œuvre le 29/07/2025, état Clôturée.", "3277397863/%231191500.docx", "Closed"),
    ("9591993533", "#1191580", "Yes", "Yes", "Fait", "Reponse de l'organisme: remarque non retenue\nAmelioration integree ensuite : MSM Ed10 Rev01 du 14/09/2026, par.1.6.1 et 1.6.2, tableau des revisions 'change management procedure aligned with ORA.GEN.130 - prior approval vs notification (1)'.", "2025-10-06", None, "3277398178/%231191580.docx", "Closed"),
    ("18244087279", "#1255840", "Yes", "Yes", "Fait", "Capture d'écran 2025-12-16 à 17.02.29.png (liste des tâches annuelles du FSTD manager dans Monday), ajoutée le 16/12/2025.", "2025-12-19", None, "3277407303/%231255840.docx", "Closed"),
    ("18244106127", "#1255860", "Yes", "Yes", "Fait", "Capture d'écran 2025-12-16 à 17.27.44.png (organigramme ASTONFLY intégrant le CMM Adjoint), ajoutée le 16/12/2025.", "2025-12-19", None, "3277407678/%231255860.docx", "Closed"),
    ("18244124358", "#1255880", "Yes", "Yes", "Fait", "Attestation de formation à l'utilisation du AL250 – Alexandre Cayol ; Attestation de formation à l'utilisation du AL250 – Arthur Delandre. Ajoutées le 16/12/2025.", "2025-12-19", None, "3277408088/%231255880.docx", "Closed"),
    ("13262714079", "#1416080", None, None, None, None, None, None, None, "Open"),
    ("13262684430", "#1416100", "Awaiting", "Awaiting", "Awaiting", "Action 1 réalisée : ENR-ATO-01 Éd.2 Rév.4 du 05/10/2026, approuvée par l'AM. Actions 2 à 4 à réaliser.", None, None, None, "Open"),
    ("13262664265", "#1416040", "Awaiting", "Awaiting", "Awaiting", "Action 2 réalisée : MSM Éd.10 Rév.01 (#248582, approuvé le 29/09/2026). Action 3 en place : CC-07 depuis le 18/09/2026, indicateur C10 ENR-CM-06. Action 1 à réaliser (échéance 20/11/2026).", None, None, None, "Open"),
    ("13262684326", "#1416120", None, None, None, None, None, None, None, "Open"),
    ("13462689728", "#1442880", "NA", "NA", "NA", None, "2026-11-04", "Vu dans Monday : remarque de l'autorité prise en compte, aucune réponse attendue (NA).", None, "Vu"),
    ("13462717176", "#1442860", "NA", "NA", "NA", None, "2026-11-04", "Vu dans Monday : remarque de l'autorité prise en compte, aucune réponse attendue (NA).", None, "Vu"),
    ("13335752216", "#1436260", None, None, None, None, None, None, None, "Open"),
    ("13335748524", "#1436240", None, None, None, None, None, None, None, "Open"),
]

def q(v):
    if v is None:
        return "null"
    return "'" + str(v).replace("'", "''") + "'"

out = ["""-- 10/11 · Authority audits as the authority shares them (Guillaume: « regarde dans Monday les informations réellement partagées »).
-- Audit: report received on, report files, closed on. Finding: the authority's reference (METEOR), its decisions on the root cause,
-- the plan and the proof of implementation, the proof itself, an extension of the deadline and its reason, the finding file.
alter table audits add column if not exists report_received_on date;     -- authority audit: date the report / findings were notified
alter table audits add column if not exists report_files text[] not null default '{}';
alter table findings add column if not exists authority_ref text;          -- METEOR / TM-CAD / EASA reference of the finding (#1416040)
alter table findings add column if not exists authority_rca text check (authority_rca in ('awaiting','yes','no','na'));
alter table findings add column if not exists authority_pac text check (authority_pac in ('awaiting','yes','no','na'));
alter table findings add column if not exists authority_proof text check (authority_proof in ('awaiting','yes','no','na'));
alter table findings add column if not exists proof text;                  -- proof of implementation sent to the authority
alter table findings add column if not exists extension text check (extension in ('1m','3m','reworked'));
alter table findings add column if not exists extension_reason text;
alter table findings add column if not exists finding_file text;           -- the authority's finding sheet (link)
"""]
for num, rec, closed, files in audits:
    arr = "array[" + ",".join(q(M + f) for f in files) + "]::text[]" if files else "'{}'::text[]"
    out.append(f"update audits set report_received_on = {q(rec)}, report_files = {arr}"
               + (f", closed_at = coalesce(closed_at, {q(closed + 'T12:00:00Z')}::timestamptz)" if closed else "")
               + f" where kind = 'authority' and number = {q(num)};")
for sid, ref, rca, pac, prf, proof, closed, note, file, st in findings:
    sets = [f"authority_ref = {q(ref)}", f"authority_rca = {q(A[rca])}", f"authority_pac = {q(A[pac])}", f"authority_proof = {q(A[prf])}", f"proof = {q(proof)}", f"finding_file = {q(M + file) if file else 'null'}"]
    if note:
        sets.append(f"extension_reason = {q(note)}")
    if st in ("Closed", "Vu"):
        sets.append(f"status = 'closed', closed_at = {q((closed or '2026-11-04') + 'T12:00:00Z')}::timestamptz")
        if st == "Vu":
            sets.append("closed_note = 'Vu — remarque prise en compte, aucune réponse attendue par l''autorité'")
    out.append(f"update findings set {', '.join(sets)} where imported_from = {q('Monday Compliance Software · subitem ' + sid)};")
out.append("""
-- Monday's root cause / plan of #1416040 and #1416100 were sent to the DSAC and are awaiting its acceptance: they stay « plan in progress »
-- internally (Compliance accepted the answer) and the sheet shows « with the authority — awaiting acceptance ».
""")
sys.stdout.write("\n".join(out) + "\n")
