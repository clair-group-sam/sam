// S.A.M. · Web Manuals export (read-only). Run in the browser console of clairgroup.webmanuals.aero while signed in.
//   await samWmExport(5328721, 'TEC', 'CAE')                  → pages + images + toc  (WEBPAGE document)
//   await samWmExport(5328721, 'TEC', 'CAE', { pdfOnly: true }) → the official PDF of the published revision
//   await samWmExport(4239499, 'TEC', 'CERT-CAO')             → a FILE document (certificate, approval letter…)
// Each call downloads wm-export_<ENT>_<CODE>_<id>_rev<NN>[_pdf].json → S.A.M. › Settings › Integrations.
async function samWmExport(M, entity, code, opts = {}) {
  const j = async (u) => (await fetch(u, { credentials: 'include' })).json();
  const b64of = async (blob) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
  const web = (await j(`/rest/api/reader/manual/${M}/web`)).data;
  const R = web.revision?.id || web.lastAvailableRevision?.id;
  const manual = { wmId: M, name: web.name, type: web.type, revisionId: R, issue: web.revision?.issue, rev: web.revision?.name, revisionDate: web.revision?.revisionDate, publishedDate: web.revision?.publishedDate, pdfURL: web.revision?.pdfURL };
  let bundle;
  if (web.type === 'FILE' || opts.pdfOnly) {
    let url, name;
    if (web.type === 'FILE') { const f = (await j(`/rest/api/reader/manual/${M}/file`)).data; const f0 = f.files[0]; name = f0.path; url = `/file/5e9ebb44afc65e080b6afb05/${encodeURIComponent(f0.path)}?fileId=${f0.fileId}`; }
    else { url = web.revision.pdfURL; name = url.split('?')[0].split('/').pop(); }
    const blob = await (await fetch(url, { credentials: 'include' })).blob();
    bundle = { format: 'sam-wm-export/1', kind: web.type === 'FILE' ? 'file' : 'pdf', exportedAt: new Date().toISOString(), source: location.host, manual, toc: [], pages: [], images: {}, file: { name, type: blob.type || 'application/pdf', size: blob.size, b64: await b64of(blob) } };
  } else {
    const toc = (await j(`/rest/api/reader/manual/${M}/toc/${R}`)).data;
    const pages = []; const imgs = new Map();
    for (const p of web.pages) {
      const d = (await j(`/rest/api/reader/manual/${M}/page/${R}/${p.id}`)).data;
      const html = d.html.replace(/<img([^>]*)src="(\/file\/[^"]+)"/g, (m, a, src) => { const id = (/fileId=(\d+)/.exec(src) || [])[1] || String(imgs.size + 1); const name = src.split('?')[0].split('/').pop() || ('img' + id); if (!imgs.has(id)) imgs.set(id, { src, name }); return `<img${a}data-sam-img="${id}" src="sam-img://${id}"`; });
      pages.push({ id: p.id, number: p.number, name: p.name, isChapter: p.isChapter, html });
    }
    const images = {};
    for (const [id, v] of imgs) { const b = await (await fetch(v.src, { credentials: 'include' })).blob(); images[id] = { name: v.name, type: b.type, size: b.size, b64: await b64of(b) }; }
    bundle = { format: 'sam-wm-export/1', kind: 'pages', exportedAt: new Date().toISOString(), source: location.host, manual, toc, pages, images };
  }
  const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `wm-export_${entity}_${code}_${M}_rev${bundle.manual.rev || '00'}${bundle.kind === 'pdf' ? '_pdf' : ''}.json`; document.body.appendChild(a); a.click();
  return { kind: bundle.kind, pages: bundle.pages.length, images: Object.keys(bundle.images).length, bytes: blob.size, rev: bundle.manual.rev, file: bundle.file?.name };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// WM-02 · one S.A.M. manual from a Web Manuals FOLDER (Astonfly / Astonjet SAS keep one WM document per chapter: A.00, A.01… B.01 DA42…).
// Run in the console of clairgroup.webmanuals.aero/admin (the folder listing needs the admin API; the pages come from the reader API).
//   await samWmInventory('ASTONFLY')                                   → prints every WEBPAGE document of that root with its folder and id
//   await samWmExportCategory(39109753, 'ASFFR', 'OM-A')                → every WEBPAGE document of the folder (and sub-folders) → ONE bundle
//   await samWmExportCategory(39829729, 'ASFFR', 'OM-B-DA42', { exclude: /draft/i })
//   options: recursive (default true), include / exclude (RegExp on the document name), maxPartMB (default 45: bigger exports are split
//   into .partNofM.json files that S.A.M. › Settings › Integrations reassembles), ids (explicit list of WM document ids instead of a folder)
async function samWmInventory(rootName) {
  const j = async (u) => (await fetch(u, { credentials: 'include' })).json();
  const t = (await j('/rest/api/admin/categories/allowed/tree')).data;
  const cats = []; const walk = (n, path) => { const p = [...path, n.name.trim()]; cats.push({ id: n.id, path: p.join(' / '), count: n.documentCount }); for (const c of (n.children || [])) walk(c, p); };
  for (const r of (Array.isArray(t.tree) ? t.tree : [t.tree])) walk(r, []);
  const out = [];
  for (const c of cats.filter((c) => c.count > 0 && (!rootName || c.path.toUpperCase().startsWith(rootName.toUpperCase())))) {
    const d = (await j(`/rest/api/admin/categories/${c.id}`)).data;
    for (const m of (d.documentList || [])) if (m.type === 'WEBPAGE') out.push(`${c.id} | ${m.id} | ${c.path} | ${m.name}`);
  }
  console.log(out.join('\n')); return out.length;
}
async function samWmExportCategory(categoryId, entity, code, opts = {}) {
  const j = async (u) => (await fetch(u, { credentials: 'include' })).json();
  const b64of = async (blob) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
  const recursive = opts.recursive !== false;
  let docs = [];
  if (opts.ids) docs = opts.ids.map((id) => ({ id, name: String(id) }));
  else {
    const t = (await j('/rest/api/admin/categories/allowed/tree')).data;
    const ids = []; const find = (n) => { if (n.id === categoryId) { const take = (x) => { ids.push(x.id); if (recursive) for (const c of (x.children || [])) take(c); }; take(n); return true; } return (n.children || []).some(find); };
    for (const r of (Array.isArray(t.tree) ? t.tree : [t.tree])) if (find(r)) break;
    if (!ids.length) throw new Error('Folder not found: ' + categoryId);
    for (const cid of ids) { const d = (await j(`/rest/api/admin/categories/${cid}`)).data; for (const m of (d.documentList || [])) if (m.type === 'WEBPAGE') docs.push({ id: m.id, name: m.name }); }
  }
  docs = docs.filter((d) => (!opts.include || opts.include.test(d.name)) && !(opts.exclude && opts.exclude.test(d.name)));
  // order: by the reference at the start of the name (A.00, A.08.01, B.03…), numerically
  const key = (n) => { const m = /^([A-Z]?)\.?(\d+(?:\.\d+)*)/.exec(n.trim()); return m ? [m[1], ...m[2].split('.').map(Number)] : ['~', n]; };
  docs.sort((a, b) => { const ka = key(a.name), kb = key(b.name); for (let i = 0; i < Math.max(ka.length, kb.length); i++) { const x = ka[i] ?? -1, y = kb[i] ?? -1; if (x !== y) return x < y ? -1 : 1; } return 0; });
  const parts = []; const toc = []; const pages = []; const imgs = new Map(); let latest = null;
  for (const d of docs) {
    const web = (await j(`/rest/api/reader/manual/${d.id}/web`)).data;
    const R = web.revision?.id || web.lastAvailableRevision?.id; const rv = web.revision || web.lastAvailableRevision || {};
    if (!R) { console.warn('no revision', d.name); continue; }
    const part = { wmId: d.id, name: web.name, revisionId: R, issue: rv.issue, rev: rv.name, revisionDate: rv.revisionDate, publishedDate: rv.publishedDate, pages: web.pages.length };
    parts.push(part); if (!latest || (rv.revisionDate || '') > (latest.revisionDate || '')) latest = part;
    const t = (await j(`/rest/api/reader/manual/${d.id}/toc/${R}`)).data;
    for (const x of t) toc.push({ ...x, part: d.id });
    for (const p of web.pages) {
      const pg = (await j(`/rest/api/reader/manual/${d.id}/page/${R}/${p.id}`)).data;
      const html = pg.html.replace(/<img([^>]*)src="(\/file\/[^"]+)"/g, (m, a, src) => { const id = (/fileId=(\d+)/.exec(src) || [])[1] || String(imgs.size + 1); const name = src.split('?')[0].split('/').pop() || ('img' + id); if (!imgs.has(id)) imgs.set(id, { src, name }); return `<img${a}data-sam-img="${id}" src="sam-img://${id}"`; });
      pages.push({ id: p.id, number: p.number, name: p.name, isChapter: p.isChapter, html, part: d.id });
    }
    console.log(`${d.name}: ${web.pages.length} pages, rev ${rv.name}`);
  }
  const images = {};
  for (const [id, v] of imgs) { try { const b = await (await fetch(v.src, { credentials: 'include' })).blob(); images[id] = { name: v.name, type: b.type, size: b.size, b64: await b64of(b) }; } catch (e) { console.warn('image', id, e); } }
  const manual = { wmId: parts[0]?.wmId ?? categoryId, name: opts.title || code, type: 'WEBPAGE', revisionId: latest?.revisionId ?? 0, issue: parts[0]?.issue, rev: opts.rev || (latest?.revisionDate ? latest.revisionDate.replace(/-/g, '').slice(2) : '00'), revisionDate: latest?.revisionDate, publishedDate: latest?.publishedDate, composite: true, categoryId, parts };
  const bundle = { format: 'sam-wm-export/2', kind: 'pages', exportedAt: new Date().toISOString(), source: location.host, manual, toc, pages, images };
  const text = JSON.stringify(bundle); const max = (opts.maxPartMB || 45) * 1024 * 1024;
  const base = `wm-export_${entity}_${code}_${categoryId}_rev${manual.rev}`;
  const dl = (name, t) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'application/json' })); a.download = name; document.body.appendChild(a); a.click(); };
  if (text.length <= max) dl(`${base}.json`, text);
  else { const n = Math.ceil(text.length / max); for (let i = 0; i < n; i++) { dl(`${base}.part${i + 1}of${n}.json`, text.slice(i * max, (i + 1) * max)); await new Promise((r) => setTimeout(r, 800)); } }
  return { documents: parts.length, pages: pages.length, images: Object.keys(images).length, bytes: text.length, rev: manual.rev, parts: parts.map((p) => `${p.name} rev ${p.rev}`) };
}
