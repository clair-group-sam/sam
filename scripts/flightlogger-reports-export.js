/*
 * S.A.M. · FlightLogger SMS reports collector (SAF-07, Astonfly). READ-ONLY: GET requests only, nothing is changed in FlightLogger.
 * Use: in FlightLogger, open Safety Management › Reports, paste this script in the browser console (or run it as a bookmarklet).
 * It reads every report (open and closed) of the list and copies them for S.A.M.; then in S.A.M. › Safety › Reports (Astonfly),
 * "Retrieve from FlightLogger" › paste › Check › Import. New reports are created there; known ones only get their FlightLogger status.
 */
(async () => {
  const base = location.pathname.replace(/\/sms\/.*$/, "") + "/sms/reports";
  const seen = new Set(); const out = []; let url = `${base}?show_closed=1&per_page=100`;
  for (let page = 0; url && page < 30; page++) {
    const d = new DOMParser().parseFromString(await (await fetch(url, { credentials: "include" })).text(), "text/html");
    const table = d.querySelector("#reportstable");
    for (const tr of table ? table.querySelectorAll("tbody tr") : []) {
      const td = [...tr.querySelectorAll("td")]; if (td.length < 7) continue;
      const link = [...tr.querySelectorAll("a")].map((a) => a.pathname).find((p) => /\/sms\/[a-z_]+\/\d+\/edit$/.test(p)) || "";
      const m = /\/sms\/([a-z_]+)\/(\d+)\/edit$/.exec(link) || [];
      const [no, flId] = td[1].textContent.trim().split(/\s+/);
      if (!/^\d+$/.test(no || "") || seen.has(no)) continue; seen.add(no);
      const st = td[6].querySelector("option[selected]") || td[6].querySelector("select")?.selectedOptions?.[0]; // the status is a select in FlightLogger: read only, never changed
      out.push({ no, flId: flId || m[2] || "", kind: m[1] || "", aircraft: td[0].textContent.trim(), type: td[2].textContent.trim().replace(/\s+/g, " "), date: td[3].textContent.trim(),
        headline: td[4].textContent.trim().replace(/\s+/g, " "), risk: td[5].textContent.trim().replace(/\s+/g, " "), status: st ? st.textContent.trim() : null });
    }
    const frame = d.querySelector("#sms_reports_table") || d;
    const next = [...frame.querySelectorAll("a")].find((a) => /Next/.test(a.textContent) && a.getAttribute("href") && a.getAttribute("href") !== "#" && !a.closest(".disabled"));
    const nu = next ? new URL(next.getAttribute("href"), location.href).toString() : null;
    url = nu && nu !== url ? nu : null;
  }
  // the narrative, when this account may open the report (FlightLogger sends others back to the list)
  for (const r of out) {
    if (!r.kind || !r.flId) continue;
    try {
      const res = await fetch(`${base.replace(/reports$/, "")}${r.kind}/${r.flId}/edit`, { credentials: "include" });
      if (!/\/edit$/.test(new URL(res.url).pathname)) continue;
      const d = new DOMParser().parseFromString(await res.text(), "text/html");
      const ta = [...d.querySelectorAll("textarea")].map((t) => t.value || t.textContent).filter((t) => t && t.trim().length > 10);
      if (ta.length) r.narrative = ta.join("\n\n").trim();
    } catch { /* keep the list data */ }
  }
  const json = JSON.stringify({ source: "flightlogger", reports: out });
  window.__samFlightLogger = json;
  try { await navigator.clipboard.writeText(json); } catch {
    const b = document.createElement("button"); b.textContent = `Copy ${out.length} reports for S.A.M.`; b.style.cssText = "position:fixed;top:12px;right:12px;z-index:99999;padding:10px 14px;background:#0d2a3f;color:#fff;border-radius:6px";
    b.onclick = async () => { await navigator.clipboard.writeText(json); b.textContent = "Copied — paste it in S.A.M."; }; document.body.appendChild(b);
  }
  console.log(`S.A.M.: ${out.length} FlightLogger reports collected${out.some((r) => r.narrative) ? " (with narratives)" : ""}.`);
  return out.length;
})();
