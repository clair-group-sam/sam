// S.A.M. · WM-03 Web Manuals bridge (read-only on Web Manuals). Run in the console of clairgroup.webmanuals.aero/admin while signed in.
// It reads every document of a root folder and hands it to the S.A.M. bridge page (Settings › Integrations › Web Manuals bridge),
// opened from this tab so the two pages can talk. Nothing is downloaded to the computer and nothing is changed in Web Manuals.
//   samBridge.link('https://<sam host>')      → adds a link to click: it opens the bridge page
//   await samBridge.inventory('ASTONJET (MT)') → lists the documents (type, published revision, working revision, changed pages)
//   await samBridge.run('ASJMT', { manuals: true, certificates: true })
(() => {
  const j = async (u) => (await fetch(u, { credentials: 'include' })).json();
  const dec = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  const B = window.samBridge = window.samBridge || {};
  Object.assign(B, { pending: B.pending || new Map(), seq: B.seq || 0, results: B.results || [], state: B.state || 'idle' });
  if (!B.listening) { B.listening = true; window.addEventListener('message', (ev) => { if (!B.origin || ev.origin !== B.origin) return; const m = ev.data || {};
    if (m.type === 'SAM_BRIDGE_READY') { B.win = ev.source; B.ready = true; }
    if (m.type === 'SAM_BRIDGE_ACK') { const f = B.pending.get(m.seq); if (f) { B.pending.delete(m.seq); f(m); } } }); }
  B.link = (origin) => { B.origin = origin; const a = document.createElement('a'); a.id = 'sam-bridge-link'; a.href = origin + '/set/integ/bridge'; a.target = 'samBridge'; a.rel = 'opener'; a.textContent = 'Open the S.A.M. bridge';
    a.style.cssText = 'position:fixed;left:40%;top:40%;z-index:99999;background:#0d2a3f;color:#fff;padding:18px 26px;border-radius:8px;font:600 16px sans-serif'; document.body.appendChild(a); return 'click the link'; };
  const send = (payload, transfer) => new Promise((res, rej) => { if (!B.win) return rej(new Error('bridge not linked')); const seq = ++B.seq; B.pending.set(seq, res); B.win.postMessage({ ...payload, seq }, B.origin, transfer || []); });
  B.send = send;

  B.inventory = async (root) => {
    const t = (await j('/rest/api/admin/categories/allowed/tree')).data; const cats = [];
    const walk = (n, path) => { const p = [...path, n.name.trim()]; cats.push({ id: n.id, path: p, count: n.documentCount }); for (const c of (n.children || [])) walk(c, p); };
    for (const r of (Array.isArray(t.tree) ? t.tree : [t.tree])) walk(r, []);
    const docs = [];
    for (const c of cats.filter((c) => c.count > 0 && c.path[0] === root)) { const d = (await j(`/rest/api/admin/categories/${c.id}`)).data; for (const m of (d.documentList || [])) docs.push({ id: m.id, name: dec(m.name), type: m.type, path: c.path.slice(1).map(dec) }); }
    const q = docs.slice(); const work = async () => { for (;;) { const d = q.shift(); if (!d) return; try {
      if (d.type === 'FILE') { const f = (await j(`/rest/api/reader/manual/${d.id}/file`)).data; const fs = (f.files || []).filter((x) => !x.isFolder); d.file = fs[0] ? { path: fs[0].path, fileId: fs[0].fileId } : null; }
      else { const w = (await j(`/rest/api/reader/manual/${d.id}/web`)).data; const r = w.revision || w.lastAvailableRevision; d.pub = r && r.publishedDate ? { id: r.id, issue: r.issue, name: r.name, date: r.revisionDate, published: r.publishedDate, pdfURL: r.pdfURL } : null;
        const e = (await j(`/rest/api/admin/editor/${d.id}/web`)).data; const er = e.revision || {}; d.ed = { id: er.id, issue: er.issue, name: er.name, isPublished: er.isPublished, date: er.revisionDate, changed: (e.pages || []).filter((p) => p.contentChange).length, pages: (e.pages || []).length }; }
    } catch (err) { d.err = String(err.message || err); } } };
    await Promise.all(Array.from({ length: 6 }, work)); B.docs = docs; return docs.length;
  };

  // --- naming: the code of a manual in S.A.M. (what projects and links key on), from the Web Manuals folder and name
  const TYPES = { C525: 'C25M', C25M: 'C25M', C68A: 'C68A', C680A: 'C68A', FA7X: 'FA7X', GL7T: 'GL7T', GLEX: 'GLEX', 'TBM 700': 'TBM7' };
  const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9.]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 44).replace(/-+$/, '');
  B.codeOf = (d) => { const p = d.path.join(' / '); const n = d.name; const prj = d.path[1] === 'PROJECTS'; let c = null;
    const typ = d.path.map((x) => TYPES[x]).find(Boolean);
    if (!prj) {
      if (/^OM-[ACD]$/.test(n)) c = n; else if (n === 'GOM') c = 'GOM'; else if (/^MSM - /.test(n)) c = 'MSM'; else if (/- GSM$/.test(n)) c = 'GSM';
      else if (/^Continuing Airworthiness Management Exposition$/.test(n)) c = 'CAME'; else if (n === 'SECURITY MANUAL') c = 'SEC-MANUAL';
      else if (/^EFB POLICY and PROCEDURES MANUAL$/.test(n)) c = 'EFB';
      else if (/^OM-[AC] NCC$/.test(n)) c = n.replace(' ', '-');
      else if (/\/ AOC \/ OM-B \//.test(' / ' + p) && typ) c = /MEL/i.test(n) ? `MEL-${typ}` : /^OM-B /.test(n) ? `OM-B-${typ}` : null;
      else if (/\/ NCC \/ GLEX/.test(' / ' + p)) c = /MEL/i.test(n) ? 'MEL-NCC-GLEX' : 'OM-B-NCC-GLEX';
      else if (/^OMD NCC GLOBAL EXPRESS$/.test(n)) c = 'OM-D-NCC-GLEX';
    }
    if (!c) { const lead = /^((?:ENR|PRO|ERP|AJD)-[A-Z]+-[A-Z0-9]+)\b/.exec(n); c = lead ? lead[1] : slug(n); }
    if (prj) c = 'PRJ-' + c;
    return c.slice(0, 48); };
  const ownerOf = (d) => { const p = d.path.join(' / '); if (/CAMO/.test(p)) return 'NPCA'; if (/OM-D|OMD|TRAINING/.test(p + ' ' + d.name)) return 'NPCT'; if (/OCC|GROUND OPERATIONS/.test(p)) return 'NPGO'; if (/AOC|NCC|NCO|FLIGHT OPERATIONS|CABIN/.test(p)) return 'NPFO'; return 'CMM'; };

  const pagesBundle = async (d, R, pages, man, entity, code) => {
    const toc = (await j(`/rest/api/reader/manual/${d.id}/toc/${R}`)).data || [];
    const out = new Array(pages.length); const imgs = new Map(); let i = 0;
    const work = async () => { for (;;) { const k = i++; if (k >= pages.length) return; const p = pages[k]; const pd = (await j(`/rest/api/reader/manual/${d.id}/page/${R}/${p.id}`)).data;
      const html = String(pd.html || '').replace(/<img([^>]*)src="(\/file\/[^"]+)"/g, (m, a, src) => { const id = (/fileId=(\d+)/.exec(src) || [])[1]; if (!id) return m; const name = decodeURIComponent(src.split('?')[0].split('/').pop() || ('img' + id)); if (!imgs.has(id)) imgs.set(id, { src: src.replace(/&amp;/g, '&'), name }); return `<img${a}data-sam-img="${id}" src="sam-img://${id}"`; });
      out[k] = { id: p.id, number: p.number, name: p.name, isChapter: p.isChapter, html }; } };
    await Promise.all(Array.from({ length: 6 }, work));
    const have = new Set((await send({ type: 'SAM_WM_HAVE', entity, code })).have || []);
    const images = {}; const transfer = []; const ids = [...imgs.keys()]; let n = 0;
    const iw = async () => { for (;;) { const id = ids[n++]; if (!id) return; const v = imgs.get(id); if (have.has(id)) { images[id] = { name: v.name, type: '', size: 0 }; continue; }
      try { const r = await fetch(v.src, { credentials: 'include' }); const buf = await r.arrayBuffer(); images[id] = { name: v.name, type: r.headers.get('content-type') || '', size: buf.byteLength, buf }; transfer.push(buf); } catch (e) { images[id] = { name: v.name, type: '', size: 0 }; } } };
    await Promise.all(Array.from({ length: 4 }, iw));
    return { bundle: { format: 'sam-wm-export/2', kind: 'pages', exportedAt: new Date().toISOString(), source: location.host, manual: { wmId: d.id, name: d.name, type: 'WEBPAGE', revisionId: R, ...man }, toc, pages: out, images }, transfer };
  };

  B.certOf = (d) => { const n = d.name; const air = d.path[1] === 'AIRCRAFT'; const regm = air ? /\b(9H|F)-?([A-Z0-9]{3,4})\s*$/.exec(d.path[2] || '') : null; const registration = regm ? `${regm[1]}-${regm[2]}` : null;
    let kind = air ? 'other' : 'approval';
    if (air) { if (/^ARC\b/i.test(n)) kind = 'ARC'; else if (/^cofa\b/i.test(n)) kind = 'CofA'; else if (/^cofr\b/i.test(n)) kind = 'CofR'; else if (/^noise/i.test(n)) kind = 'noise'; else if (/^radio|station licen[cs]e|^LSA\b/i.test(n)) kind = 'radio'; else if (/^INS\b/i.test(n)) kind = 'aircraft_insurance'; }
    else { if (/\bAOC$/.test(n) && /^MT-/.test(n)) kind = 'AOC'; else if (/OPS SPECS?$/i.test(n)) kind = 'OpSpecs'; else if (/^MT\.CAMO/.test(n)) kind = 'CAMO'; else if (/^INS\b/.test(n)) kind = 'insurance'; }
    const issuer = /^(MT-|MT\.CAMO|NCC Operations)/.test(n) || ['ARC', 'CofA', 'CofR', 'noise'].includes(kind) && registration && registration.startsWith('9H') ? 'TM-CAD' : null;
    return { scope: air ? 'aircraft' : 'organisation', registration, kind, folder: d.path.slice(1).join(' › ') || 'CERTIFICATES', issuer }; };

  // opts: { manuals, certificates, only: (d) => boolean, drafts: true }
  B.run = async (entity, opts = {}) => {
    if (B.state === 'running') return 'already running'; B.state = 'running'; B.stop = false; const docs = (B.docs || []).filter((d) => !opts.only || opts.only(d));
    const used = new Map(); for (const d of (B.docs || []).filter((x) => x.type === 'WEBPAGE')) { let c = B.codeOf(d); if (used.has(c)) c = (c.slice(0, 38) + '-' + d.id); used.set(c, d.id); d.code = c; }
    const push = (r) => { B.results.push(r); B.last = r; };
    try {
      for (const d of docs) { if (B.stop) break;
        try {
          if (d.type === 'WEBPAGE' && opts.manuals) {
            const base = { kind: 'pages', entity, code: d.code, title: d.name, path: d.path.join(' › '), wmId: d.id, internal: /^4\./.test(d.path[0]), ownerRole: ownerOf(d), aircraftTypes: [...new Set(d.path.map((x) => TYPES[x]).filter(Boolean))] };
            if (d.pub) { const w = (await j(`/rest/api/reader/manual/${d.id}/web`)).data; const r = w.revision;
              const { bundle, transfer } = await pagesBundle(d, r.id, w.pages || [], { issue: r.issue, rev: r.name, revisionDate: r.revisionDate, publishedDate: r.publishedDate, pdfURL: r.pdfURL }, entity, d.code);
              const a = await send({ type: 'SAM_WM_ITEM', meta: { ...base, draft: false }, bundle }, transfer); push({ id: d.id, code: d.code, what: 'published', ok: a.ok, msg: a.ok ? a.info : a.error, images: a.images, imgErr: a.imageErrors }); }
            if (opts.drafts !== false && (!d.pub || (d.ed && d.ed.changed > 0))) { const e = (await j(`/rest/api/admin/editor/${d.id}/web`)).data; const er = e.revision || {};
              const pad = (x, like) => String(x).padStart(String(like || '00').length, '0');
              const issue = er.issue || (d.pub && d.pub.issue) || '01'; const rev = er.name || (d.pub ? pad((parseInt(d.pub.name, 10) || 0) + 1, d.pub.name) : '00');
              if (d.pub && String(rev) === String(d.pub.name) && String(parseInt(issue, 10)) === String(parseInt(d.pub.issue, 10))) { push({ id: d.id, code: d.code, what: 'draft', ok: false, msg: 'working revision carries the number of the published one: skipped' }); }
              else { const pages = (e.pages || []).filter((p) => p.isIncluded !== false);
                const { bundle, transfer } = await pagesBundle(d, er.id, pages, { issue, rev, revisionDate: er.revisionDate }, entity, d.code);
                const a = await send({ type: 'SAM_WM_ITEM', meta: { ...base, draft: true, changedPages: d.pub ? d.ed.changed : 0 }, bundle }, transfer); push({ id: d.id, code: d.code, what: 'draft', ok: a.ok, msg: a.ok ? a.info : a.error, images: a.images, imgErr: a.imageErrors }); } }
          } else if (d.type === 'FILE' && opts.certificates && d.path[0].startsWith('1.')) {
            if (!d.file) { push({ id: d.id, code: d.name, what: 'file', ok: false, msg: 'no file attached in Web Manuals' }); continue; }
            const r = await fetch(`/file/5e9ebb44afc65e080b6afb05/${encodeURIComponent(d.file.path)}?fileId=${d.file.fileId}`, { credentials: 'include' }); const buf = await r.arrayBuffer();
            const a = await send({ type: 'SAM_WM_ITEM', meta: { kind: 'file', entity, code: '', title: d.name, path: null, wmId: d.id, cert: B.certOf(d) }, file: { name: d.file.path, type: r.headers.get('content-type') || 'application/pdf', buf } }, [buf]);
            push({ id: d.id, code: d.name, what: 'file', ok: a.ok, msg: a.ok ? a.info : a.error });
          }
        } catch (err) { push({ id: d.id, code: d.code || d.name, what: 'error', ok: false, msg: String(err.message || err) }); }
      }
    } finally { B.state = B.stop ? 'stopped' : 'done'; }
    return B.results.length;
  };
})();
