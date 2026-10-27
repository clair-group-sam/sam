/*
 * S.A.M. — Centrik Risk export (read-only on Centrik). Run in a Centrik tab, on Risk › ASJ Risk or AJD Risk › Assessments:
 *   samCentrikRiskExport("https://<sam host>", "<import key from Settings › Integrations>", "AJD")
 * Reads every assessment of the list (HZ / MOC / RA): set-up, decision, sign-off, hazards with each consequence, current and
 * planned mitigations, main impact, pre / post severity × likelihood — and posts them to S.A.M. in batches. Nothing is changed in Centrik.
 * Progress: window.__samRisk. AJD hazards have a "Headline", ASJ hazards a "Title".
 * Note: on the dev preview the browser blocks the direct post from Centrik (Vercel preview protection): collect, copy, paste in S.A.M. instead.
 */
async function samCentrikRiskExport(samOrigin, key, entity, opts = {}) {
  const st = (window.__samRisk = { done: 0, total: 0, hazards: 0, posted: 0, errors: [], running: true });
  const P = new DOMParser();
  const get = async (url) => P.parseFromString(await (await fetch(url, { credentials: "include" })).text(), "text/html");
  const txt = (el) => (el ? el.innerText ?? el.textContent ?? "" : "").replace(/ /g, " ").replace(/[ \t]+/g, " ").trim();
  const iso = (d) => { const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(d || ""); return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined; };
  const fields = (doc) => { const o = {}; for (const c of doc.querySelectorAll(".field-container")) { const cap = txt(c.querySelector(".field-caption")); if (!cap || o[cap] !== undefined) continue; const v = c.querySelector(".field-value") ?? c.querySelector(".field-caption")?.nextElementSibling; o[cap] = txt(v); } return o; };
  // Centrik cells separate items with <br>, <p>, <div> or <li>: keep them apart (a parsed page has no layout, innerText would glue them)
  const lines = (el) => (el ? el.innerHTML.replace(/<\/(p|div|li)>/gi, "<br>").replace(/<(p|div|li)[^>]*>/gi, "").split(/<br\s*\/?>/i).map((h) => { const d = document.createElement("div"); d.innerHTML = h; return (d.textContent || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim(); }).filter((x) => x && x !== "-") : []);
  const rating = (s) => { const m = /\b([A-E])\s+([1-5])\b/.exec(s || ""); return m ? { sev: m[1], lik: Number(m[2]) } : {}; };
  const domain = (dep, num) => /^HZ\s*IS/i.test(num) ? "Information security" : ({ "Flight Ops": "Flight Ops", "CAMO": "CAMO", "Crew Training": "Crew Training", "Ground Ops": "Ground Ops", "Compliance and Safety": "Compliance & Safety", "Support Staff": "Organisation", "(all)": "Organisation" })[dep] ?? (dep || undefined);
  const decision = (s) => /stop|reject|refus/i.test(s || "") ? "stop" : /condition/i.test(s || "") ? "continue_with_conditions" : /continue/i.test(s || "") ? "continue" : undefined;

  // 1 · the list on this page
  const rows = [...document.querySelectorAll("tr")].map((tr) => { const a = tr.querySelector('a[href*="AssessmentEvaluation.aspx"]'); if (!a) return null; const tds = [...tr.children].map(txt); const vid = /RiskAssessmentVersionId=([0-9a-f-]+)/i.exec(a.getAttribute("href"))?.[1]; return vid ? { vid, number: tds[0], name: txt(a) || tds[1] } : null; }).filter(Boolean);
  const list = opts.only ? rows.filter((r) => opts.only.includes(r.number)) : rows;
  st.total = list.length;
  const out = [];
  const one = async (r) => {
    try {
      const base = "/Risk/";
      const [det, dec, ev] = await Promise.all([get(`${base}AssessmentDetail.aspx?RiskAssessmentVersionId=${r.vid}`), get(`${base}AssessmentDecision.aspx?RiskAssessmentVersionId=${r.vid}`), get(`${base}AssessmentEvaluation.aspx?RiskAssessmentVersionId=${r.vid}`)]);
      const f = fields(det), g = fields(dec);
      const hids = [...new Set([...ev.querySelectorAll('a[href*="HazardDetail.aspx"]')].map((a) => /RiskAssessmentHazardId=([0-9a-f-]+)/i.exec(a.getAttribute("href"))?.[1]).filter(Boolean))];
      const hazards = [];
      for (const hid of hids) {
        const hd = await get(`${base}HazardDetail.aspx?RiskAssessmentHazardId=${hid}`);
        const hf = fields(hd);
        const tb = hd.querySelector('[id$="ConsequencesDetailView"]');
        const crow = tb ? [...tb.querySelectorAll("tr")].filter((tr) => tr.querySelector("td.column-description") && tr.querySelector("td.column-matrix-before")) : [];
        crow.forEach((tr, i) => {
          const pre = rating(txt(tr.querySelector("td.column-matrix-before"))), post = rating(txt(tr.querySelector("td.column-matrix-after")));
          hazards.push({ source_ref: `${hid}#${i}`, title: (hf.Headline || hf.Title || hd.title.replace(/^Hazard\s*-\s*/, "").trim() || "Hazard") + (crow.length > 1 ? ` (${i + 1})` : ""), description: hf.Description || undefined, consequence: lines(tr.querySelector("td.column-description")).join("; ") || undefined,
            main_impact: txt(tr.querySelector("td.column-response")) || undefined, current: lines(tr.querySelector('[id$="MeasuresInPlaceField"]')), planned: lines(tr.querySelector('[id$="MeasuresPlanned"]')),
            sev_before: pre.sev, lik_before: pre.lik, sev_after: post.sev, lik_after: post.lik });
        });
        st.hazards += crow.length;
      }
      const status = f.Status || g.Status || "";
      const people = [f.Reviewer, ...(f["Additional Assessors"] || "").split(/[;\n]/)].map((x) => (x || "").replace(/^[A-Z]{2}\s+/, "").trim()).filter((x) => x && x !== "-");
      out.push({ number: f.Number || r.number, name: f.Name || r.name, description: f.Description || undefined, domain: domain(f.Department, f.Number || r.number), status: /signed off/i.test(status) ? "signed_off" : /archiv/i.test(status) ? "archived" : "draft",
        decision: decision(g.Status || status), decision_comment: g.Comments && g.Comments !== "-" ? g.Comments : undefined, top_risk: /yes/i.test(g["Is Top Risk?"] || ""), version: Number((f["Version No"] || "v1").replace(/\D/g, "")) || 1,
        conducted_on: iso(f["Last Conducted On"] || f["Conducted On"]), next_due: iso(f["Next Due By"]), signed_by_name: (g["Signed off by"] || "").replace(/^[A-Z]{2}\s+/, "") || undefined, signed_at: iso(g["Signed off on"] || f["Date Signed off"]),
        participants: [...new Set(people)].map((p) => { const m = /^(.*?)\s*\((.*)\)$/.exec(p); return m ? { name: m[1], role: m[2] } : { name: p, role: "" }; }), source_ref: r.vid, hazards });
    } catch (e) { st.errors.push(`${r.number}: ${e.message}`); }
    st.done++;
  };
  const post = async (batch) => {
    const res = await fetch(`${samOrigin}/api/import/risk`, { method: "POST", mode: "cors", credentials: "include", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ entity, source: "centrik", assessments: batch }) });
    const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok || j.error) st.errors.push(`post: ${j.error || res.status}`); else { st.posted += j.assessments; if (j.errors?.length) st.errors.push(...j.errors); }
  };
  const queue = [...list]; const workers = Array.from({ length: opts.concurrency ?? 3 }, async () => { while (queue.length) { await one(queue.shift()); if (out.length >= 10) await post(out.splice(0, out.length)); } });
  await Promise.all(workers);
  if (out.length) await post(out.splice(0, out.length));
  st.running = false;
  return st;
}
