/*
 * S.A.M. — Centrik safety reports export (read-only on Centrik). Run in a Centrik tab on Safety › Analysis (All) › All cases.
 * Reads every case of the "Safety AJD" and "Safety ASJ" subsystems (open list + closed list): report as submitted, classification
 * (ERC, MOR, category, risk register link), investigation, findings, actions, closure. Result in window.__samReports.data
 * — copy it and paste it in S.A.M. (Import from Centrik box), which posts it to /api/import/reports.
 */
async function samCentrikReports(opts = {}) {
  const st = (window.__samReports = { done: 0, total: 0, errors: [], running: true, data: [] });
  const P = new DOMParser();
  const get = async (url) => { const r = await fetch(url, { credentials: "include" }); return { url: r.url, doc: P.parseFromString(await r.text(), "text/html") }; };
  const clean = (s) => (s || "").replace(/ /g, " ").replace(/[ \t]+/g, " ").trim();
  const block = (el) => { if (!el) return ""; const h = el.innerHTML.replace(/<\/(p|div|li|h\d)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<li[^>]*>/gi, "• "); const d = document.createElement("div"); d.innerHTML = h; return (d.textContent || "").split("\n").map(clean).filter(Boolean).join("\n"); };
  const fields = (doc) => { const o = {}; for (const c of doc.querySelectorAll(".field-container")) { const cap = clean(c.querySelector(".field-caption")?.textContent); if (!cap || o[cap] !== undefined) continue; const v = c.querySelector(".field-value") ?? c.querySelector(".field-caption")?.nextElementSibling; o[cap] = block(v); } return o; };
  const pick = (f, re) => { const k = Object.keys(f).find((x) => re.test(x)); const v = k ? f[k] : ""; return v && v !== "-" ? v : undefined; };
  const ENT = { "Safety AJD": "AJD", "Safety ASJ": "ASJ" };
  const rowsOf = (doc) => [...doc.querySelectorAll("tr")].map((tr) => { const a = tr.querySelector('a[href*="CaseRedirect"]'); if (!a) return null; return { sub: clean(tr.cells[0]?.textContent), no: clean(tr.cells[1]?.textContent), href: a.href }; }).filter(Boolean);
  const open = rowsOf((await get("/SMS/Case/CaseListAll.aspx?CrossSubsystem=true&menusrc=tab")).doc);
  const closed = rowsOf(document); // the page after "View Closed Cases"
  const seen = new Set(); const list = [...open, ...closed].filter((r) => ENT[r.sub] && !seen.has(r.no) && seen.add(r.no));
  st.total = list.length; st.skipped = [...open, ...closed].filter((r) => !ENT[r.sub]).length;
  const one = async (r) => {
    try {
      const cap = await get(r.href); const caseId = new URL(cap.url).searchParams.get("CaseId"); if (!caseId) throw new Error("no CaseId");
      const [cl, inv, co] = await Promise.all(["CaseClassify", "CaseInvestigate", "CaseCloseout"].map((p) => get(`/SMS/Case/${p}.aspx?CaseId=${caseId}`)));
      const f = fields(cap.doc), g = fields(cl.doc), h = fields(inv.doc), k = fields(co.doc);
      const grid = [...inv.doc.querySelectorAll("table")].find((t) => /Action ID/.test(t.textContent) && /SMS-\d+/.test(t.textContent));
      const actions = grid ? [...grid.querySelectorAll("tr")].filter((tr) => /SMS-\d+/.test(tr.textContent)).map((tr) => { const c = [...tr.cells].map((x) => clean(x.textContent)); const i = c.findIndex((x) => /^SMS-\d+$/.test(x)); return i < 0 ? null : { status: c[i - 1] || c[0], id: c[i], title: c[i + 1], owner: c[i + 2], due: c[i + 3], completed: c[i + 4] }; }).filter(Boolean) : [];
      st.data.push({ caseId, no: pick(f, /^Report Number$/) ?? r.no, entity: ENT[r.sub], type: pick(f, /Safety Report Type$/), title: pick(f, /^Report Title$/) ?? pick(g, /^Title$/) ?? r.no, description: pick(f, /^Description$/),
        event_date: pick(f, /^Event Date$/), event_time: pick(f, /^Event Time/), location: pick(f, /^Event Location$/), aircraft: pick(f, /^Aircraft Registration$/), callsign: pick(f, /^Call sign$/), phase: pick(f, /^Flight phase$/),
        submitted_by: pick(f, /^Submitted by$/), submitted_on: pick(f, /^Submitted On$/), reported_mor: pick(f, /^Mandatory or Voluntary/), confirmed_mor: pick(g, /^Confirmed MOR status$/), erc: pick(g, /^ERC Score$/), occurrence_class: pick(g, /^Occurrence class$/),
        risk_category: pick(g, /^Risk Category$/), hazard_link: pick(g, /Risk Register$/), event_type: pick(g, /^Event type$/), investigation: pick(h, /^Details of the investigations/), findings: pick(h, /^Findings and observations$/),
        closed_by: pick(k, /^Closed By$/), closed_on: pick(k, /^Closed On$/), case_phase: pick(k, /^Closed On$/) ? "Closed" : "Investigate", actions });
    } catch (e) { st.errors.push(`${r.no}: ${e.message}`); }
    st.done++;
  };
  const q = [...list]; await Promise.all(Array.from({ length: opts.concurrency ?? 4 }, async () => { while (q.length) await one(q.shift()); }));
  st.running = false; return st;
}
