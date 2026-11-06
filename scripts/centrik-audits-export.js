/*
 * S.A.M. — Centrik compliance audits export (read-only on Centrik, GET only). Run in a Centrik tab on
 * Compliance › <zone> › Checklists schedule (PeriodicChecklists.aspx?ZoneId=…). Reads the zone's audits (completed + in progress):
 * header, sections, every check (rule code, paragraph, text, result, comment), findings table. Downloads centrik-audits_<zone>.json
 * to import in S.A.M. (Compliance › Audits › Import from Centrik). Nothing is clicked, nothing is posted.
 *   await samCentrikAudits({ max: 400 })
 */
async function samCentrikAudits(opts = {}) {
  const st = (window.__samAud = { running: true, data: [], errors: [], checklists: [] }); const P = new DOMParser();
  const zone = new URL(location.href).searchParams.get("ZoneId");
  const clean = (s) => (s || "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
  const get = async (u) => { const r = await fetch(u, { credentials: "include" }); if (!r.ok) throw new Error(`HTTP ${r.status} ${u}`); return P.parseFromString(await r.text(), "text/html"); };
  const fields = (doc) => { const o = {}; for (const c of doc.querySelectorAll(".field-container")) { const cap = clean(c.querySelector(".field-caption")?.textContent); if (!cap || o[cap] !== undefined) continue; const v = c.cloneNode(true); v.querySelector(".field-caption")?.remove(); o[cap] = clean(v.textContent); } return o; };
  // 1 · the schedule (current page): checklist No. + name per subsystem
  let sub = null;
  for (const tr of document.querySelectorAll("tr")) {
    const t = clean(tr.textContent); const m = t.match(/^Subsystem:\s*(.+?)\s*\d*\s*\d*$/); if (m) { sub = m[1]; continue; }
    const cells = [...tr.cells].map((c) => clean(c.textContent)); if (cells.length >= 4 && sub && cells[0] && cells[1] && !/^No\.?$/.test(cells[0])) st.checklists.push({ subsystem: sub, no: cells[0], name: cells[1], next_due: cells[2] });
  }
  // 2 · the audits of the zone
  const list = await get(`/Quality/Audit/Audits.aspx?ZoneId=${zone}`);
  const audits = []; let group = null;
  for (const el of list.querySelectorAll("h2, h3, h4, caption, tr")) {
    if (el.tagName !== "TR") { const t = clean(el.textContent); if (/(Completed|In Progress|Not Started)$/.test(t)) group = t; continue; }
    const a = el.querySelector('a[href*="AuditDetail"]'); if (!a) continue;
    const cells = [...el.cells].map((c) => clean(c.textContent));
    audits.push({ group, no: cells[0], name: cells[1], href: a.href });
  }
  st.total = audits.length; const max = opts.max ?? 500;
  const seen = new Set();
  for (const au of audits.slice(0, max)) {
    if (seen.has(au.href)) continue; seen.add(au.href);
    try {
      const d = await get(au.href); const f = fields(d);
      const team = (lab) => clean([...d.querySelectorAll(".field-container")].find((c) => clean(c.querySelector(".field-caption")?.textContent) === lab)?.textContent.replace(lab, ""));
      const secLinks = [...d.querySelectorAll('a[href*="AuditSection"]')].map((x) => ({ title: clean(x.textContent), href: new URL(x.getAttribute("href"), location.href).href })).filter((x, i, arr) => arr.findIndex((y) => y.href === x.href) === i);
      const sections = [];
      for (const sl of secLinks) {
        const sd = await get(sl.href); const items = []; let code = null, title = null;
        for (const tr of sd.querySelectorAll("tr")) {
          const numEl = tr.querySelector(":scope > td.number"); if (!numEl) continue;
          const num = clean(numEl.querySelector(".field-value")?.textContent); const nameTd = tr.querySelector(":scope > td.name");
          const text = clean(nameTd?.querySelector(":scope > .field-container .field-value")?.textContent);
          if (numEl.classList.contains("heading")) { code = num; title = text; continue; }
          const compTd = tr.querySelector(":scope > td.compliant"); const result = clean(compTd?.querySelector(".resultField")?.textContent);
          const comment = clean([...(compTd?.querySelectorAll(":scope > .field-container") ?? [])].find((c) => /Comment/i.test(c.querySelector(".field-caption")?.textContent || ""))?.querySelector(".field-value")?.textContent);
          items.push({ code, title, ref: num, text, result: result || null, comment: comment || null });
        }
        sections.push({ title: sl.title, items });
      }
      const ftab = [...d.querySelectorAll("table")].find((t) => /Finding Title/.test(t.textContent) && /Severity/.test(t.textContent));
      const findings = ftab ? [...ftab.querySelectorAll("tr")].filter((tr) => tr.cells.length >= 5 && !/Finding Title/.test(tr.textContent)).map((tr) => [...tr.cells].map((c) => clean(c.textContent))).filter((c) => c[0] && !/No Findings/.test(c[0])).map((c) => ({ no: c[0], title: c[1], severity: c[2], phase: c[3], manager: c[4], close_by: c[5] })) : [];
      st.data.push({ group: au.group, subsystem: (au.group || "").replace(/\s*(Completed|In Progress|Not Started)$/, ""), no: f["Audit Number"] || au.no, name: f["Audit Name"] || au.name, status: f["Status"], due: f["Audit Due On"], started: f["Started On"], completed: f["Completed On"], lead: team("Lead Auditor"), auditors: team("Auditors"), description: f["Description"], completion: f["Completion"], breakdown: f["Results Breakdown"], sections, findings });
    } catch (e) { st.errors.push(`${au.no}: ${e.message}`); }
  }
  st.running = false;
  const blob = new Blob([JSON.stringify({ zone, exported_at: new Date().toISOString(), checklists: st.checklists, audits: st.data })], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `centrik-audits_${zone.slice(0, 8)}.json`; a.click();
  return { audits: st.data.length, checks: st.data.reduce((n, x) => n + x.sections.reduce((m, s) => m + s.items.length, 0), 0), errors: st.errors };
}
