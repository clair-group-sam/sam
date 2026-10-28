/*
 * S.A.M. — Centrik safety meetings export (read-only on Centrik). Run in a Centrik tab on Safety › Analysis (All) › All cases, after « View Closed Cases ».
 * Reads every case of the "Safety Meeting" subsystem (open + closed lists): title, date, minutes (description), actions (Act phase).
 * Result in window.__samMtg.data — paste it in S.A.M. (Safety › Committees), which posts it to /api/import/committees.
 */
async function samCentrikMeetings() {
  const st = (window.__samMtg = { running: true, data: [], errors: [] }); const P = new DOMParser();
  const get = async (u) => { const r = await fetch(u, { credentials: "include" }); return { url: r.url, doc: P.parseFromString(await r.text(), "text/html") }; };
  const clean = (s) => (s || "").replace(/ /g, " ").replace(/[ \t]+/g, " ").trim();
  const block = (el) => { if (!el) return ""; const h = el.innerHTML.replace(/<\/(p|div|li|h\d)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<li[^>]*>/gi, "• "); const d = document.createElement("div"); d.innerHTML = h; return d.textContent.split("\n").map(clean).join("\n").replace(/\n{3,}/g, "\n\n").trim(); };
  const fields = (doc) => { const o = {}; for (const c of doc.querySelectorAll(".field-container")) { const cap = clean(c.querySelector(".field-caption")?.textContent); if (!cap || o[cap] !== undefined) continue; const v = c.cloneNode(true); v.querySelector(".field-caption")?.remove(); o[cap] = block(v); } return o; };
  const rowsOf = (doc) => [...doc.querySelectorAll("tr")].map((tr) => { const a = tr.querySelector('a[href*="CaseRedirect"]'); return a ? { sub: clean(tr.cells[0]?.textContent), no: clean(tr.cells[1]?.textContent), href: a.href } : null; }).filter(Boolean);
  const open = rowsOf((await get("/SMS/Case/CaseListAll.aspx?CrossSubsystem=true&menusrc=tab")).doc); const closed = rowsOf(document);
  const seen = new Set(); const list = [...open, ...closed].filter((r) => r.sub === "Safety Meeting" && !seen.has(r.no) && seen.add(r.no)); st.total = list.length;
  for (const r of list) {
    try {
      const cap = await get(r.href); const caseId = new URL(cap.url).searchParams.get("CaseId");
      const [act, co] = await Promise.all(["CaseAct", "CaseCloseout"].map((p) => get(`/SMS/Case/${p}.aspx?CaseId=${caseId}`)));
      const f = fields(cap.doc), k = fields(co.doc);
      const t = [...act.doc.querySelectorAll("table")].filter((t) => /SMS-\d+/.test(t.textContent)).pop(); const ids = new Set();
      const actions = t ? [...t.querySelectorAll("tr")].filter((tr) => tr.cells.length === 6 && /SMS-\d+/.test(tr.cells[1]?.textContent || "")).map((tr) => { const c = [...tr.cells].map((x) => clean(x.textContent)); return { status: c[0], id: c[1].match(/SMS-\d+/)[0], title: c[2], owner: c[3], due: c[4], completed: c[5] }; }).filter((a) => !ids.has(a.id) && ids.add(a.id)) : [];
      st.data.push({ caseId, no: f["Report Number"] || r.no, title: f["Report Title"] || r.no, description: f["Description"] || "", event_date: f["Event Date"], event_time: f["Event Time (UTC, hh:mm)"], submitted_by: f["Submitted by"], closed_on: k["Closed On"], actions });
    } catch (e) { st.errors.push(`${r.no}: ${e.message}`); }
  }
  st.running = false; return st;
}
