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
