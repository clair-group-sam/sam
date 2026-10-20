// S.A.M. · Web Manuals export (read-only). Run in the browser console of clairgroup.webmanuals.aero while signed in.
// Usage:  await samWmExport(5328721, 'TEC', 'CAE')   → downloads wm-export_TEC_CAE_5328721_revNN.json
// Then: S.A.M. › Settings › Integrations › Web Manuals import bridge.
async function samWmExport(M, entity, code) {
  const j = async (u) => (await fetch(u, { credentials: 'include' })).json();
  const web = (await j(`/rest/api/reader/manual/${M}/web`)).data;
  const R = web.revision?.id || web.lastAvailableRevision?.id;
  const toc = (await j(`/rest/api/reader/manual/${M}/toc/${R}`)).data;
  const pages = []; const imgs = new Map();
  for (const p of web.pages) {
    const d = (await j(`/rest/api/reader/manual/${M}/page/${R}/${p.id}`)).data;
    const html = d.html.replace(/<img([^>]*)src="(\/file\/[^"]+)"/g, (m, a, src) => {
      const id = (/fileId=(\d+)/.exec(src) || [])[1] || String(imgs.size + 1);
      const name = src.split('?')[0].split('/').pop() || ('img' + id);
      if (!imgs.has(id)) imgs.set(id, { src, name });
      return `<img${a}data-sam-img="${id}" src="sam-img://${id}"`;
    });
    pages.push({ id: p.id, number: p.number, name: p.name, isChapter: p.isChapter, html });
  }
  const images = {};
  for (const [id, v] of imgs) {
    const b = await (await fetch(v.src, { credentials: 'include' })).blob();
    const b64 = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(b); });
    images[id] = { name: v.name, type: b.type, size: b.size, b64 };
  }
  const bundle = { format: 'sam-wm-export/1', exportedAt: new Date().toISOString(), source: location.host,
    manual: { wmId: M, name: web.name, revisionId: R, issue: web.revision?.issue, rev: web.revision?.name, revisionDate: web.revision?.revisionDate, publishedDate: web.revision?.publishedDate, pdfURL: web.revision?.pdfURL },
    toc, pages, images };
  const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `wm-export_${entity}_${code}_${M}_rev${bundle.manual.rev || '00'}.json`; document.body.appendChild(a); a.click();
  return { pages: pages.length, images: Object.keys(images).length, bytes: blob.size, rev: bundle.manual.rev };
}
