// S.A.M. · Web Manuals → Safety promotion history (read-only). Run in the console of clairgroup.webmanuals.aero/admin while signed in.
//   await samWmPromotions(39867614)   // ASTONFLY (FR) › 5.MEETING › FLIGHT SAFETY REPORT
// Downloads every PDF of the folder (latest version only when a name has V1 / V2 / V3) and wm-promotions_<folder>.json (names, ids, dates).
// Then in S.A.M. › Safety › Safety promotion (Astonfly) › "Import from Web Manuals": select the JSON and the PDFs together.
async function samWmPromotions(folderId) {
  const j = async (u) => (await fetch(u, { credentials: 'include' })).json();
  const d = (await j(`/rest/api/admin/categories/${folderId}`)).data;
  const docs = (d.documentList || []).filter((m) => m.type === 'FILE');
  const base = (n) => n.replace(/\s*V\d+\s*$/i, '').trim(); const ver = (n) => Number((/V(\d+)\s*$/i.exec(n) || [])[1] || 0);
  const latest = new Map(); for (const m of docs) { const k = base(m.name); const cur = latest.get(k); if (!cur || ver(m.name) > ver(cur.name)) latest.set(k, m); }
  const out = [];
  for (const m of latest.values()) {
    const web = (await j(`/rest/api/reader/manual/${m.id}/web`)).data;
    const f0 = (await j(`/rest/api/reader/manual/${m.id}/file`)).data.files[0];
    const url = `/file/5e9ebb44afc65e080b6afb05/${encodeURIComponent(f0.path)}?fileId=${f0.fileId}`;
    const blob = await (await fetch(url, { credentials: 'include' })).blob();
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = f0.path; document.body.appendChild(a); a.click(); a.remove();
    out.push({ wmId: m.id, name: m.name, versions: docs.filter((x) => base(x.name) === base(m.name)).length, file: f0.path, pages: f0.nbrPages, size: blob.size, published: web.revision?.publishedDate || null });
    await new Promise((r) => setTimeout(r, 400));
  }
  const meta = new Blob([JSON.stringify({ format: 'sam-wm-promotions/1', folderId, folder: d.name, exportedAt: new Date().toISOString(), items: out })], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(meta); a.download = `wm-promotions_${folderId}.json`; document.body.appendChild(a); a.click(); a.remove();
  return { pdfs: out.length, skippedOlderVersions: docs.length - out.length };
}
