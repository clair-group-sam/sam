"use client";
import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { bridgeImport, bridgeStats, type BridgeMeta } from "@/app/(app)/set/integ/bridge/actions";
import { imageExt, type WmBundle } from "@/lib/wm-import";
import { safeKey } from "@/lib/cert";

/* WM-03 · the receiving end of the Web Manuals bridge. Opened from the Web Manuals tab, it takes each document that tab reads,
 * stores images and files in the private buckets with the signed-in person's rights, and writes the manual, revision or certificate. */
const WM = "https://clairgroup.webmanuals.aero";
type Img = { name: string; type: string; size: number; buf?: ArrayBuffer };
type Item = { type: string; seq: number; meta: BridgeMeta; bundle?: Omit<WmBundle, "images"> & { images?: Record<string, Img> }; file?: { name: string; type: string; buf: ArrayBuffer }; entity?: string; code?: string };

export default function WmBridge() {
  const [linked, setLinked] = useState(false); const [n, setN] = useState({ ok: 0, ko: 0 }); const [log, setLog] = useState<string[]>([]);
  const chain = useRef<Promise<void>>(Promise.resolve()); const have = useRef(new Map<string, Map<string, string>>()); // folder → image id → extension as stored
  useEffect(() => {
    const sb = supabaseBrowser();
    const say = (m: string) => setLog((l) => [m, ...l].slice(0, 300));
    const listed = async (folder: string) => {
      if (have.current.has(folder)) return have.current.get(folder)!;
      const set = new Map<string, string>();
      for (let off = 0; ; off += 1000) { const { data } = await sb.storage.from("manuals").list(folder, { limit: 1000, offset: off }); for (const f of data ?? []) set.set(f.name.replace(/\.[^.]+$/, ""), f.name.split(".").pop() ?? "png"); if (!data || data.length < 1000) break; }
      have.current.set(folder, set); return set;
    };
    const handle = async (m: Item): Promise<Record<string, unknown>> => {
      if (m.type === "SAM_WM_PING") return { ok: true, info: "bridge ready" };
      if (m.type === "SAM_WM_STATS") return { ...(await bridgeStats(m.entity ?? "")) };
      if (m.type === "SAM_WM_HAVE") return { ok: true, have: [...(await listed(`${m.entity}/${safeKey(m.code ?? "")}/wm`)).keys()] };
      if (m.type !== "SAM_WM_ITEM") return { ok: false, error: "unknown message" };
      const meta = m.meta;
      if (meta.kind === "file") {
        if (!m.file?.buf) return { ok: false, error: "no file" };
        const key = `${meta.entity}/wm/${meta.wmId}/${safeKey(m.file.name)}`;
        const { error } = await sb.storage.from("certificates").upload(key, m.file.buf, { upsert: true, contentType: m.file.type || "application/pdf" });
        if (error) return { ok: false, error: `upload: ${error.message}` };
        return { ...(await bridgeImport({ ...meta, filePath: `certificates/${key}` })) };
      }
      const b = m.bundle; if (!b) return { ok: false, error: "no bundle" };
      const folder = `${meta.entity}/${safeKey(meta.code)}/wm`; const set = await listed(folder);
      const images = b.images ?? {}; const ext: Record<string, string> = {}; const ids = Object.keys(images); let up = 0; const errs: string[] = [];
      const todo = ids.filter((id) => { ext[id] = set.get(id) ?? imageExt(images[id].name, images[id].type); return images[id].buf && !set.has(id); });
      const work = async () => { for (;;) { const id = todo.shift(); if (!id) return; const im = images[id]; const e = ext[id];
        const { error } = await sb.storage.from("manuals").upload(`${folder}/${id}.${e}`, im.buf!, { upsert: true, contentType: im.type && im.type !== "application/octet-stream" ? im.type : e === "png" ? "image/png" : e === "jpg" ? "image/jpeg" : "application/octet-stream" });
        if (error) errs.push(`${id}: ${error.message}`); else { up++; set.set(id, e); } } };
      await Promise.all([work(), work(), work(), work()]);
      const slim = { ...b, images: Object.fromEntries(ids.map((id) => [id, { name: images[id].name, type: images[id].type, size: images[id].size }])) };
      const stash = `_import/${meta.entity}/${safeKey(meta.code)}-${meta.draft ? "draft" : "pub"}.json`;
      const { error: se } = await sb.storage.from("manuals").upload(stash, new Blob([JSON.stringify(slim)], { type: "application/json" }), { upsert: true, contentType: "application/json" });
      if (se) return { ok: false, error: `bundle: ${se.message}` };
      const r = await bridgeImport({ ...meta, imageExt: ext, imageBase: `/api/files/manuals/${folder}`, stash });
      return { ...r, images: up, imageErrors: errs.slice(0, 5) };
    };
    const on = (ev: MessageEvent) => {
      if (ev.origin !== WM) return; const m = ev.data as Item; if (!m || typeof m.type !== "string" || !m.type.startsWith("SAM_WM_")) return;
      const src = ev.source as Window | null;
      chain.current = chain.current.then(async () => {
        let r: Record<string, unknown>;
        try { r = await handle(m); } catch (e) { r = { ok: false, error: e instanceof Error ? e.message : String(e) }; }
        if (m.type === "SAM_WM_ITEM") { setN((x) => (r.ok ? { ...x, ok: x.ok + 1 } : { ...x, ko: x.ko + 1 })); say(`${r.ok ? "ok" : "ERROR"} · ${m.meta.code || m.meta.title} · ${String(r.ok ? r.info : r.error)}`); }
        src?.postMessage({ type: "SAM_BRIDGE_ACK", seq: m.seq, ...r }, WM);
      });
    };
    window.addEventListener("message", on);
    if (window.opener) { try { (window.opener as Window).postMessage({ type: "SAM_BRIDGE_READY" }, WM); setLinked(true); } catch { /* not opened from Web Manuals */ } }
    return () => window.removeEventListener("message", on);
  }, []);
  return (
    <section className="card">
      <div className="ch"><span className="eyebrow">Web Manuals bridge</span><span className={"pill " + (linked ? "green" : "amber")}>{linked ? "linked to the Web Manuals tab" : "open this page from the Web Manuals tab"}</span></div>
      <div className="cb">
        <p><b>{n.ok}</b> document{n.ok === 1 ? "" : "s"} written{n.ko ? <>, <b className="red">{n.ko} in error</b></> : null}. Keep this tab open during the run.</p>
        <pre className="log mt-2" style={{ maxHeight: 420, overflow: "auto" }}>{log.join("\n") || "Waiting for the Web Manuals tab…"}</pre>
      </div>
      <div className="cb mini" style={{ borderTop: "1px solid var(--line)" }}>Only messages from {WM.replace("https://", "")} are accepted. Nothing is changed in Web Manuals: its documents are read, then written here with your rights. Each import is in the audit log.</div>
    </section>
  );
}
