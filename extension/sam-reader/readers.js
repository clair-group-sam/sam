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
  const recent = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
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
      const status = c(cSt); if (!status) continue;
      // decided in the last 13 months: listed for information, so S.A.M. can say "Signed Off on the portal" on a file it still holds open
      if (CLOSED.test(status)) { const sub = iso(c(cSub)); if (sub && sub >= recent) lines.push({ entity: "ASJMT", kind: "info", number: c(cNo), title: c(cTitle) || c(cType), registry, status, submitted_on: sub }); continue; }
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

// METEOR (DSAC) is a single-page application: its screens load their data themselves. The reader listens to what the page receives
// (it never builds a request of its own and never touches the session token), moves from screen to screen by the address only
// (#dossiers, #dossiers/<version>, #constatations) and keeps a few fields per line. Runs in the page's own world.
async function readMeteor() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const iso = (s) => { const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s || ""); return m ? `${m[3]}-${m[2]}-${m[1]}` : /^\d{4}-\d{2}-\d{2}/.test(s || "") ? s.slice(0, 10) : null; };
  const plain = (h) => String(h ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 20 && !/DECONNEXION/i.test(document.body.innerText) && !document.querySelector('input[type="password"]'); i++) await sleep(500);
  if (document.querySelector('input[type="password"]') || !/DECONNEXION/i.test(document.body.innerText)) return { signIn: true };
  const head = (document.body.innerText.match(/[^\n]*-\s*[^\n]*DECONNEXION/i) || [""])[0].replace(/DECONNEXION/i, "").trim();
  const entity = /ASTONFLY/i.test(head) ? "ASFFR" : /ASTONJET/i.test(head) ? "ASJFR" : null;
  if (!entity) return { error: `METEOR account not recognised (« ${head.slice(0, 60)} »): expected ASTONJET or ASTONFLY` };
  // what the page receives, kept while we read
  const cap = [];
  if (!window.__samReaderHook) {
    window.__samReaderHook = { cap };
    const O = XMLHttpRequest.prototype.open, S = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) { this.__samU = String(u); return O.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function () { this.addEventListener("load", () => { try { if (/\/api\//.test(this.__samU)) window.__samReaderHook.cap.push({ u: this.__samU, res: this.responseText }); } catch { /* not text */ } }); return S.apply(this, arguments); };
    const F = window.fetch;
    window.fetch = async function (i) { const r = await F.apply(this, arguments); try { const u = typeof i === "string" ? i : i.url; if (/\/api\//.test(u)) r.clone().text().then((t) => window.__samReaderHook.cap.push({ u, res: t })); } catch { /* */ } return r; };
  } else window.__samReaderHook.cap = cap;
  const got = (re) => { const c = [...cap].reverse().find((x) => re.test(x.u)); if (!c) return undefined; try { return JSON.parse(c.res); } catch { return null; } };
  const go = async (hash, re, ms = 15000) => { cap.length = 0; if (location.hash === hash || /^#(dossiers|constatations)$/.test(hash)) { location.hash = "#"; await sleep(900); cap.length = 0; } location.hash = hash; const t0 = Date.now(); while (Date.now() - t0 < ms) { if (got(re) !== undefined) { await sleep(900); return true; } await sleep(250); } return false; };
  // the lists load 50 lines, then more as the page is scrolled: scroll until nothing new comes
  const rowsOf = () => { const T = [...document.querySelectorAll("table")].sort((x, y) => y.rows.length - x.rows.length)[0]; return T ? T.rows.length : 0; };
  const loadAll = async () => { let n = rowsOf(); for (let i = 0; i < 12 && n >= 50; i++) { window.scrollTo(0, document.documentElement.scrollHeight); for (const el of document.querySelectorAll("*")) if (el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 200) el.scrollTop = el.scrollHeight; await sleep(1500); const m = rowsOf(); if (m <= n) break; n = m; } return n; };
  const lines = [], skipped = [];
  // 1. dossiers (the list shows the open ones)
  if (await go("#dossiers", /\/dossier\/listForSearch/)) {
    // a search left in the list (an identifier typed earlier) would hide every other dossier: empty the search fields and let the page search again
    const typed = [...document.querySelectorAll("input.form-control, input[type=text], input[type=search]")].filter((i) => i.offsetParent && i.value);
    if (typed.length) {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      for (const i of typed) { set.call(i, ""); for (const ev of ["input", "change", "keyup"]) i.dispatchEvent(new Event(ev, { bubbles: true })); }
      const btn = [...document.querySelectorAll("button, a, input[type=button], input[type=submit]")].find((x) => /^rechercher$/i.test(String(x.innerText || x.value || "").trim()));
      if (btn) { cap.length = 0; btn.click(); const t0 = Date.now(); while (Date.now() - t0 < 15000 && got(/\/dossier\/listForSearch/) === undefined) await sleep(250); await sleep(900); skipped.push("Dossiers: a search was left in the list; it was emptied to read every dossier"); }
    }
    await loadAll();
    const seen = new Set(); const list = cap.filter((x) => /\/dossier\/listForSearch/.test(x.u)).flatMap((x) => { try { return JSON.parse(x.res) || []; } catch { return []; } }).filter((d) => d && d.dosId && !seen.has(d.dosId) && seen.add(d.dosId));
    // closed dossiers (CLOS - Approuvé, Remplacé, Accusé de réception, refusé…) stay on the portal: only the running ones are followed
    const running = list.filter((d) => !/^\s*clos/i.test(String(d.statutAffichage || "")) && d.etaCd !== "CLO");
    const recent = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
    for (const d of list) if (!running.includes(d) && iso(d.derniereVersion) && iso(d.derniereVersion) >= recent) lines.push({ entity, kind: "info", number: `#${d.identifiant}`, title: String(d.objet || "").trim(), status: String(d.statutAffichage || "").trim(), submitted_on: iso(d.derniereVersion) });
    for (const d of running) {
      const l = { entity, kind: "file", number: `#${d.identifiant}`, title: String(d.objet || "").trim(), status: String(d.statutAffichage || "").trim(), due: iso(d.echeanceSouhaitee), type_hint: String(d.categorie || "").split(".").pop(),
        url: `https://meteor-app.dsac.aviation-civile.gouv.fr/meteor-externe/#dossiers/${d.verIdLastVersion}`, submitted_on: iso(d.derniereVersion) };
      if (d.verIdLastVersion && await go(`#dossiers/${d.verIdLastVersion}`, /\/filEchange/)) {
        const arr = (x) => (Array.isArray(x) ? x : []); const v = got(/\/dossier\/getVersionDossier\//) || {}; const ag = arr(got(/\/agentDsac/)); const fils = arr(got(/\/filEchange/));
        l.assessor = ag.map((a) => a.prenomNomConcat || [a.prenom, a.nom].filter(Boolean).join(" ")).filter(Boolean).join(", ") || null;
        if (Array.isArray(v.typeDossierListDto) && v.typeDossierListDto.length) l.type_hint = `${l.type_hint} ${v.typeDossierListDto.map((t) => t.titre).join(", ")}`.trim();
        const sent = v.demandeEnvoyee !== false;
        const all = fils.flatMap((f) => arr(f.commentaireListDto).map((c) => ({ on: String(c.dateAjout || "").slice(0, 10), at: String(c.dateAjout || ""), dsac: !!c.utilisateur?.isDsac, who: [c.utilisateur?.prenom, c.utilisateur?.nom].filter(Boolean).join(" "), text: plain(c.valeur) }))).sort((a, b) => (a.at < b.at ? 1 : -1));
        if (all[0]) { l.last_exchange = `${all[0].dsac ? "DSAC, " : ""}${all[0].who}: ${all[0].text}`.slice(0, 400); l.last_exchange_on = all[0].on || null; l.comments = all.length; }
        const open = fils.some((f) => f.ouvert);
        l.turn = !sent || /remarques dsac|à traiter|non envoy|préparation|incomplet/i.test(l.status) ? "us" : all[0] && all[0].dsac && open ? "us" : "authority";
        if (!sent) l.status = `${l.status} (not sent)`;
      } else { skipped.push(`${l.number}: detail not read`); l.turn = /remarques dsac|à traiter|préparation|incomplet/i.test(l.status) ? "us" : "authority"; }
      lines.push(l);
    }
  } else skipped.push("Dossiers: the list did not load");
  // 2. constatations (the table as displayed: number, title, level, limit date, state and status, surveillance act)
  let observations = 0; const closedCount = 0;
  if (await go("#constatations", /\/constatations\/(\?|$)/)) {
    await sleep(1200); await loadAll();
    const T = [...document.querySelectorAll("table")].find((t) => /Intitul/i.test(txt(t.tHead || t.rows[0])));
    const rows = T ? [...T.tBodies[0].rows] : [];

    for (const r of rows) {
      const c = [...r.cells].map((td) => (td.children.length > 1 ? [...td.children].map(txt).filter(Boolean).join(", ") : txt(td))); if (c.length < 6) continue;
      const [num, title, level, limit, state, act] = c;
      if (/observation/i.test(level) || /class[ée]e|non suivie/i.test(state)) { observations++; continue; }
      if (/^(sans suite|cl[oô]tur|clos|ferm)/i.test(state)) continue;
      lines.push({ entity, kind: "finding", number: `#${num}`, title, level, due: iso(limit), status: state, origin: act, url: `https://meteor-app.dsac.aviation-civile.gouv.fr/meteor-externe/#constatation/${num}`, turn: /attente de correction|à traiter|réponse attendue|refus/i.test(state) ? "us" : "authority" });
    }
  } else skipped.push("Constatations: the list did not load");
  location.hash = "#";
  return { account: head, entity, lines, observations, skipped, closed: typeof closedCount === "number" ? closedCount : 0 };
}
