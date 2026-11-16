// S.A.M. Reader · one function per portal, injected in the portal's own tab. Each returns { account, lines, read, skipped } or
// { signIn: true }. Only GET requests to the portal's own pages; the page is never clicked.

async function readTmcad() {
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const iso = (s) => { const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s || ""); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
  const get = async (url) => { const r = await fetch(url, { credentials: "include" }); if (!r.ok) throw new Error(`${r.status} on ${url.split("?")[0]}`); return new DOMParser().parseFromString(await r.text(), "text/html"); };
  if (/login|signin|account\/log/i.test(location.pathname) || document.querySelector('input[type="password"]')) return { signIn: true };
  const regs = [...new Map([...document.querySelectorAll('a[href*="ApplicationForms.aspx"]')].map((a) => [(/RegistrySubsystemId=([0-9a-f-]+)/i.exec(a.getAttribute("href")) || [])[1], (a.getAttribute("title") || txt(a))])).entries()].filter((x) => x[0]);
  if (!regs.length) return { signIn: true };
  const CLOSED = /signed off|approved|closed|rejected|withdrawn|cancelled|completed|^published$/i;
  const lines = [], assessors = new Set(), skipped = []; let read = 0;
  for (const [id, name] of regs) {
    let d; try { d = await get(`/Registry/ApplicationForms.aspx?RegistrySubsystemId=${id}&menusrc=menu`); } catch (e) { skipped.push(`${name}: ${e.message}`); continue; }
    const T = d.querySelector('table[id$="RegAppsDataTable"]'); if (!T) continue; read++;
    const registry = (d.title || name).replace(/^Regulatory Applications\s*-\s*/i, "");
    const head = [...T.rows[0].cells].map((c) => txt(c)); const col = (n) => head.findIndex((h) => h.toLowerCase() === n);
    const cNo = col("no"), cType = col("application type"), cOrg = col("applicant organisation"), cTitle = col("title"), cSub = col("submitted on"), cSt = col("status"), cAs = col("assessor"), cDue = col("due on");
    for (const r of [...T.rows].slice(1)) {
      if (r.classList.contains("groupHeader") || r.cells.length < head.length - 1) continue;
      const off = head.length - r.cells.length; // data rows have no cell under the first (selector) header
      const c = (i) => (i >= 0 && r.cells[i - off] ? txt(r.cells[i - off]) : ""); const a = r.querySelector('a[href*="RegAppApplication.aspx"]');
      if (c(cAs)) assessors.add(c(cAs));
      const status = c(cSt); if (!status || CLOSED.test(status)) continue;
      const formId = a ? (/RegistryApplicationFormId=([0-9a-f-]+)/i.exec(a.getAttribute("href")) || [])[1] : null;
      // conflict-zone notifications and unsent drafts are listed, not followed
      lines.push({ entity: "ASJMT", kind: /conflict zone/i.test(registry) || /^draft$/i.test(status) ? "info" : "file", number: c(cNo), title: c(cTitle) || c(cType), type_hint: c(cType), registry, organisation: c(cOrg), status, assessor: c(cAs) || null,
        submitted_on: iso(c(cSub)), due: iso(c(cDue)), url: formId ? `https://tmcad.totalaoc.com/Registry/RegAppApplication.aspx?RegistryApplicationFormId=${formId}` : null, _form: formId });
    }
  }
  // the thread of each open application: the last comment says where it stands and whose turn it is
  for (const l of lines) {
    if (!l._form || l.kind !== "file") { delete l._form; continue; }
    try {
      const d = await get(`/Registry/RegAppComments.aspx?RegistryApplicationFormId=${l._form}`);
      const rows = [...(d.querySelector("table.commentTable")?.rows ?? [])].filter((r) => !r.querySelector("th") && r.cells.length >= 2 && txt(r.cells[r.cells.length - 2]));
      const parse = (r) => { const by = txt(r.cells[r.cells.length - 1]); const m = /^(.*?)\s*(\d{2}\/\d{2}\/\d{4})(?:\s+(\d{2}:\d{2}))?$/.exec(by); return { text: txt(r.cells[r.cells.length - 2]), who: m ? m[1].trim() : by, on: m ? iso(m[2]) : null }; };
      const all = rows.map(parse).filter((x) => x.on).sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : 0));
      if (all[0]) { l.last_exchange = `${all[0].who}: ${all[0].text}`.slice(0, 400); l.last_exchange_on = all[0].on; l._lastWho = all[0].who; l.comments = rows.length; }
    } catch (e) { skipped.push(`${l.number}: comments not read (${e.message})`); }
    delete l._form;
  }
  // whose turn: the portal's own wording first, then who wrote last (an assessor of the authority, or us)
  const isAuthority = (who) => !!who && [...assessors].some((a) => { const [last] = a.split(","); return last && who.toLowerCase().includes(last.trim().toLowerCase()); });
  for (const l of lines) {
    if (l.kind !== "file") continue;
    l.turn = /requires info|draft|awaiting payment|returned/i.test(l.status) ? "us" : l._lastWho ? (isAuthority(l._lastWho) ? "us" : "authority") : "authority";
    delete l._lastWho;
  }
  const account = txt(document.querySelector('[id*="UserName"], .userName, .user-name')) || null;
  return { account, organisation: [...new Set(lines.map((l) => l.organisation).filter(Boolean))].join(", ") || null, lines, read, registries: regs.length, skipped };
}
