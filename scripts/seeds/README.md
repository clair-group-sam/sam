# Compliance seeds — Astonfly (ASFFR) and Astontec (ASTFR)

Re-import procedure (10/11/2026, redone before go-live from fresh copies):

1. `supabase db push` — `20261110170000_asf_tec_compliance_reset.sql` removes every audit, programme and finding of ASFFR / ASTFR
   (checks, auditors, subcontractors, watch and regulation are kept); `20261110180000_tec_compliance_seed.sql` adds the Astontec
   subcontractors / contractors (CAE §E.2 / §E.3) and recurring checks (CTR-01…05).
2. Signed in as Compliance on the preview, in the browser console (same origin):
   ```js
   const post = async (u, b) => (await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
   await post('/api/import/monday-audits', await (await fetch('/seeds/monday-compliance-software-2026-11-10.json')).json());   // or paste the file
   await post('/api/import/programme', await (await fetch('/seeds/programme-asffr-2025-2027.json')).json());
   await post('/api/import/programme', await (await fetch('/seeds/programme-astfr-2025-2027.json')).json());
   ```
   (the files are not served by the app: paste their content in place of the `fetch('/seeds/…')`.)
3. Order matters: Monday first (audits with their numbers), then the programmes (they attach the Monday audits by number: ATO2025,
   NCO2025, FSTD2025-02, FSTD2025-11, CC2026, RO2025). Authority audits (DSAC / OSAC / EASA) are never part of a programme.

Sources: ENR-ATO-01 Programme d'audit ASTONFLY 2025-2027 Ed2 Rev4 (05/10/2026, SharePoint Management System › ASTONFLY › ATO › 01 - Programme
de surveillance); Monday « Compliance Software » (board 8192369625); CAE FR.CAO.0058 Rev 05 §B.1 / B.2 / B.3 / B.7 / E.2 / E.3.
