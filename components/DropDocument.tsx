"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { analyseDrop, certFolders, discardDrop, fileDrop, type DropProposal, type Existing } from "@/app/(app)/docs/drop/actions";

type Kind = { id: string; label: string; scope: "organisation" | "aircraft" };
type Item = { file: File; status: "reading" | "ready" | "filed" | "error"; error?: string; inbox?: string; p?: DropProposal; existing?: Existing[]; replaces?: string[]; preview?: string };

const toB64 = (f: File) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] ?? ""); r.readAsDataURL(f); });

/** Drop zone: each file is read by SAM, which proposes entity / kind / aircraft / dates; the user confirms or corrects, then files it. */
export default function DropDocument({ entities, kinds }: { entities: { code: string; name: string }[]; kinds: Kind[] }) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const [folders, setFolders] = useState<Record<string, string[]>>({});
  useEffect(() => { void certFolders().then(setFolders); }, []);
  const set = (i: number, patch: Partial<Item>) => setItems((xs) => xs.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const setP = (i: number, patch: Partial<DropProposal>) => setItems((xs) => xs.map((x, k) => (k === i && x.p ? { ...x, p: { ...x.p, ...patch } } : x)));

  async function add(files: FileList | File[]) {
    const list = Array.from(files);
    const start = items.length;
    setItems((xs) => [...xs, ...list.map((file) => ({ file, status: "reading" as const }))]);
    // one document at a time: SAM reads each in turn, the proposals appear as they are ready
    for (const [k, file] of list.entries()) {
      const r = await analyseDrop({ name: file.name, type: file.type, b64: await toB64(file) });
      if (r.ok) set(start + k, { status: "ready", inbox: r.inbox, p: r.proposal, existing: r.existing, replaces: r.existing.map((e) => e.id), preview: r.preview });
      else set(start + k, { status: "error", error: r.error });
    }
  }
  async function file(i: number) {
    const it = items[i]; if (!it.p || !it.inbox) return;
    const r = await fileDrop({ inbox: it.inbox, p: it.p, replaces: it.replaces ?? [] });
    if (r.ok) { set(i, { status: "filed" }); void certFolders().then(setFolders); router.refresh(); } else set(i, { error: r.error });
  }
  async function drop(i: number) { const it = items[i]; if (it.inbox) await discardDrop({ inbox: it.inbox }); setItems((xs) => xs.filter((_, k) => k !== i)); }

  return (
    <div>
      <label className={"dropzone" + (over ? " over" : "")} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); void add(e.dataTransfer.files); }}>
        <input type="file" multiple accept="application/pdf,image/*" hidden onChange={(e) => { if (e.target.files) void add(e.target.files); e.target.value = ""; }} />
        <b>Drop documents here</b><span>or click to choose — several at once if you like; PDF or image, up to 7 MB each. SAM reads them one by one.</span>
      </label>
      {items.map((it, i) => (
        <section key={i} className="card mt-4 dropcard">
          <div className="ch"><span className="eyebrow">{it.file.name}</span>
            <span className={"pill " + (it.status === "filed" ? "green" : it.status === "error" ? "red" : it.status === "ready" ? "amber" : "")}>{it.status === "reading" ? (items.findIndex((x) => x.status === "reading") === i ? "SAM is reading the document…" : "waiting — SAM reads one document at a time") : it.status === "ready" ? "proposal — please check" : it.status === "filed" ? "filed" : "error"}</span></div>
          {it.error && <div className="cb mini red">{it.error}</div>}
          {it.p && it.status !== "filed" && (
            <div className="cb dropgrid">
              <div className="droppreview">{it.preview && (it.file.type === "application/pdf" ? <iframe src={it.preview} title="preview" /> : <img src={it.preview} alt="" />)}</div>
              <div>
                <p className="text-[13px] mb-2">{it.p.summary}</p>
                <p className="mini mb-3">SAM's confidence: <b>{it.p.confidence}</b> — {it.p.why}</p>
                <div className="grid grid-cols-2 gap-2">
                  <label><span className="eyebrow">Entity</span><select className="inp" value={it.p.entity} onChange={(e) => setP(i, { entity: e.target.value })}>{entities.map((e) => <option key={e.code} value={e.code}>{e.code} — {e.name}</option>)}</select></label>
                  <label><span className="eyebrow">Kind</span><select className="inp" value={it.p.kind} onChange={(e) => { const k = kinds.find((x) => x.id === e.target.value); setP(i, { kind: e.target.value, scope: k?.scope ?? it.p!.scope }); }}>{kinds.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select></label>
                  <label><span className="eyebrow">For</span><select className="inp" value={it.p.scope} onChange={(e) => setP(i, { scope: e.target.value as "organisation" | "aircraft" })}><option value="organisation">the organisation</option><option value="aircraft">an aircraft</option></select></label>
                  <label><span className="eyebrow">Registration</span><input className="inp" value={it.p.registration ?? ""} disabled={it.p.scope !== "aircraft"} onChange={(e) => setP(i, { registration: e.target.value.toUpperCase() })} placeholder="F-XXXX" /></label>
                  <label><span className="eyebrow">Folder</span>
                    <select className="inp" value={(folders[it.p.entity] ?? []).includes(it.p.folder) ? it.p.folder : "__new"} onChange={(e) => setP(i, { folder: e.target.value === "__new" ? "" : e.target.value })}>
                      {(folders[it.p.entity] ?? []).map((f) => <option key={f} value={f}>{f}</option>)}
                      <option value="__new">New folder…</option>
                    </select></label>
                  <label><span className="eyebrow">{(folders[it.p.entity] ?? []).includes(it.p.folder) ? "or a new folder" : "New folder name"}</span><input className="inp" value={(folders[it.p.entity] ?? []).includes(it.p.folder) ? "" : it.p.folder} placeholder="e.g. Insurance, Aircraft › F-HXXX" onChange={(e) => setP(i, { folder: e.target.value })} /></label>
                  <label className="col-span-2"><span className="eyebrow">Title</span><input className="inp" value={it.p.title} onChange={(e) => setP(i, { title: e.target.value })} /></label>
                  <label><span className="eyebrow">Issuer</span><input className="inp" value={it.p.issuer ?? ""} onChange={(e) => setP(i, { issuer: e.target.value })} /></label>
                  <label><span className="eyebrow">Reference</span><input className="inp" value={it.p.reference ?? ""} onChange={(e) => setP(i, { reference: e.target.value })} /></label>
                  <label><span className="eyebrow">Issued on</span><input type="date" className="inp" value={it.p.issued_on ?? ""} onChange={(e) => setP(i, { issued_on: e.target.value || null })} /></label>
                  <label><span className="eyebrow">Valid until</span><input type="date" className="inp" value={it.p.valid_until ?? ""} onChange={(e) => setP(i, { valid_until: e.target.value || null })} /></label>
                </div>
                <p className="mini mt-3">Goes to <b>Certificates & Validities › {it.p.entity} › {it.p.folder || "(choose a folder)"}</b> · {kinds.find((k) => k.id === it.p!.kind)?.label}{it.p.scope === "aircraft" ? ` · ${it.p.registration || "registration?"}` : ""}{it.p.valid_until ? ` · alerts at 90 / 30 / 7 days before ${it.p.valid_until}` : " · no expiry date, no alert"}.</p>
                {!!it.existing?.length && (
                  <div className="mt-2 p-2 border border-line rounded-lg">
                    <div className="eyebrow mb-1">It replaces</div>
                    {it.existing.map((x) => <label key={x.id} className="audchk"><input type="checkbox" checked={it.replaces?.includes(x.id) ?? false} onChange={(e) => set(i, { replaces: e.target.checked ? [...(it.replaces ?? []), x.id] : (it.replaces ?? []).filter((y) => y !== x.id) })} /> {x.title}{x.registration ? ` · ${x.registration}` : ""} — valid until {x.valid_until ?? "no expiry"} <span className="mini">(kept as superseded)</span></label>)}
                  </div>
                )}
                <div className="flex gap-2 mt-3">
                  <button type="button" className="btn primary" onClick={() => void file(i)} disabled={(it.p.scope === "aircraft" && !it.p.registration) || !it.p.folder?.trim()}>File it here</button>
                  <button type="button" className="btn" onClick={() => void drop(i)}>Discard</button>
                </div>
              </div>
            </div>
          )}
          {it.status === "filed" && <div className="cb mini">Filed in Certificates & Validities{it.p?.valid_until ? `, valid until ${it.p.valid_until}` : ""}.</div>}
        </section>
      ))}
    </div>
  );
}
