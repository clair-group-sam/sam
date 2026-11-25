"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { receivePortalReading } from "@/app/(app)/proj/auth/sync/actions";

/* PRJ-05 · « Read the portals »: asks the S.A.M. Reader extension to open the authority portals in the person's own Chrome session,
 * read them (read-only) and hand the lines back; S.A.M. applies what mirrors the portal and shows only the exceptions. */
type Result = { portal: string; label?: string; account?: string | null; entity?: string | null; observations?: number; lines?: unknown[]; signIn?: boolean; error?: string; skipped?: string[] };
type Summary = Awaited<ReturnType<typeof receivePortalReading>>;
const ACCOUNT: Record<string, string> = { ASFFR: "ASTONFLY", ASJFR: "ASTONJET" };
/** `entity`: the entity chosen in the top bar; null in the Group view. Only its portals are asked for, and a METEOR session signed in with the other entity's account is not applied. */
export default function PortalReadButton({ portals, entity = null }: { portals: { key: string; label: string }[]; entity?: string | null }) {
  const router = useRouter(); const [ext, setExt] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null); const [sum, setSum] = useState<Summary | null>(null); const [notes, setNotes] = useState<string[]>([]);
  const reqId = useRef("");
  useEffect(() => { const t = setTimeout(() => setExt(document.documentElement.dataset.samReader ?? null), 400); return () => clearTimeout(t); }, []);
  useEffect(() => {
    const on = async (ev: MessageEvent) => {
      if (ev.source !== window || ev.origin !== location.origin) return; const m = ev.data as { type?: string; id?: string; progress?: string; done?: boolean; results?: Result[]; disconnected?: boolean };
      if (m?.type !== "SAM_READER" || m.id !== reqId.current) return;
      if (m.progress) setBusy(m.progress);
      if (m.done && !m.results) { if (m.disconnected) setBusy((b) => (b ? null : b)); return; }
      if (m.done && m.results) {
        reqId.current = ""; const n: string[] = [];
        for (const r of m.results) { if (r.signIn) n.push(`${r.label ?? r.portal}: sign in on the portal in Chrome, then click again.`); else if (r.error) n.push(`${r.label ?? r.portal}: ${r.error}`); for (const sk of r.skipped ?? []) n.push(sk);
          if (r.portal === "meteor" && r.entity && entity && r.entity !== entity) { n.push(`METEOR is signed in with the ${ACCOUNT[r.entity] ?? r.entity} account, which belongs to ${r.entity}: nothing was applied. Sign in on METEOR with the ${ACCOUNT[entity] ?? entity} account and click again, or choose ${r.entity} in the top bar.`); r.lines = []; }
          else if (r.portal === "meteor" && r.entity && entity) n.push(`METEOR read with the ${ACCOUNT[r.entity] ?? r.entity} account (${r.lines?.length ?? 0} open lines, ${r.observations ?? 0} observations not followed).`);
          else if (r.portal === "meteor" && r.entity) n.push(`METEOR read with the ${r.entity === "ASFFR" ? "ASTONFLY" : "ASTONJET"} account (${r.lines?.length ?? 0} open lines, ${r.observations ?? 0} observations not followed). METEOR allows one account at a time: sign in with the ${r.entity === "ASFFR" ? "ASTONJET" : "ASTONFLY"} account and click again to read the other entity.`); }
        setNotes(n);
        const ok = m.results.filter((r) => Array.isArray(r.lines) && r.lines.length);
        if (!ok.length) { setBusy(null); return; }
        setBusy("Updating S.A.M.…");
        const s = await receivePortalReading(ok.map((r) => ({ portal: r.portal, label: r.label, account: r.account ?? null, lines: r.lines! })));
        setSum(s); setBusy(null); router.refresh();
      }
    };
    window.addEventListener("message", on); return () => window.removeEventListener("message", on);
  }, [router, entity]);
  const start = () => { setSum(null); setNotes([]); reqId.current = Math.random().toString(36).slice(2); setBusy("Asking the S.A.M. Reader…"); window.postMessage({ type: "SAM_READ_PORTALS", id: reqId.current, portals: portals.map((p) => p.key) }, location.origin); };
  if (ext === undefined) return null;
  return (
    <section className="card mb-4">
      <div className="ch"><span className="eyebrow">Authority portals</span><span className="flex gap-2 items-center"><Link className="mini underline" href="/proj/auth/sync">Readings kept</Link>
        {ext ? <button type="button" className="btn primary" onClick={start} disabled={!!busy}>{busy ?? "Read the portals"}</button> : <span className="mini">Install the S.A.M. Reader extension on this computer to read the portals from here (folder extension/sam-reader, Chrome, Load unpacked).</span>}</span></div>
      {(notes.length > 0 || sum) && <div className="cb">
        {sum?.ok && <p><b>{sum.created} file{sum.created === 1 ? "" : "s"} opened, {sum.updated} updated</b>, {sum.same} unchanged, {sum.info} for information. {(() => { const moved = (sum.exceptions ?? []).filter((e) => e.kind === "Stage moved").length; const look = (sum.exceptions?.length ?? 0) - moved; return `${moved ? `${moved} file${moved === 1 ? "" : "s"} moved to the stage the portal shows. ` : ""}${look ? `${look} to look at:` : "Nothing needs you."}`; })()}</p>}
        {sum && !sum.ok && <p><span className="pill red">not applied</span> {sum.error}</p>}
        {sum?.exceptions && sum.exceptions.length > 0 && <table className="tbl mt-2"><tbody>{sum.exceptions.map((e, i) => <tr key={i}><td style={{ whiteSpace: "nowrap" }}><span className={"pill " + (e.kind === "Stage moved" ? "green" : e.kind === "To check" ? "amber" : "red")}>{e.kind}</span></td><td className="mono">{e.href ? <Link className="underline" href={e.href}>{e.ref}</Link> : e.ref}</td><td className="mini">{e.text}</td></tr>)}</tbody></table>}
        {notes.map((n, i) => <p key={i} className="mini">{n}</p>)}
      </div>}
      <div className="cb mini" style={{ borderTop: "1px solid var(--line)" }}>Reads {portals.map((p) => p.label).join(", ")} in your own signed-in session, read-only. Files, status, target date, turn and last exchange are mirrored without asking; you only see what needs a decision.</div>
    </section>
  );
}
