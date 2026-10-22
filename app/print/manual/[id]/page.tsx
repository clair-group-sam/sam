import { notFound, redirect } from "next/navigation";
import { canDownloadPdf, getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { STEP_LABEL, partOf, partsOf, type Manual, type Revision, type Section } from "@/lib/docs";
import { ENT } from "@/lib/nav";
import PrintAuto from "@/components/PrintAuto";

/**
 * DOC-13 · Download PDF — the manual as S.A.M. holds it, laid out for A4 (cover, record of revisions,
 * list of effective chapters, chapters with revision bars, running header/footer with page x / y).
 * The browser's own PDF engine produces the file (Save as PDF). Restricted to AM, NP, CMM / SM and their deputies.
 */
export const dynamic = "force-dynamic";

const css = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;

export default async function PrintManual({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ rev?: string; auto?: string }> }) {
  const { id } = await params;
  const { rev, auto } = await searchParams;
  const s = await getSession();
  if (!s) redirect("/login");
  if (!canDownloadPdf(s.roles)) return <Denied />;
  const sb = await supabaseServer();
  const { data: m } = await sb.from("manuals").select("*").eq("id", id).maybeSingle();
  if (!m) notFound();
  const manual = m as Manual;
  if (!s.group && !s.entities.includes(manual.entity)) return <Denied />;

  const { data: revsData } = await sb.from("revisions").select("*").eq("manual_id", id).order("created_at", { ascending: false });
  const revs = (revsData ?? []) as Revision[];
  const published = revs.filter((r) => r.step === "published" || r.step === "repository").sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
  const current = (rev ? revs.find((r) => r.id === rev) : null) ?? published[0] ?? revs[0] ?? null;
  if (!current) notFound();
  const isPublished = current.step === "published" || current.step === "repository";
  // archive = a published revision that a later one has superseded
  const supersededBy = isPublished && published[0] && published[0].id !== current.id ? published[0] : null;
  const state: "published" | "archive" | "draft" = !isPublished ? "draft" : supersededBy ? "archive" : "published";

  const { data: sd } = await sb.from("revision_sections").select("id,ord,ref,title,body,changed").eq("revision_id", current.id).order("ord");
  const sections = (sd ?? []) as Section[];

  // figures: private bucket → one batch of signed URLs (10 min) instead of one redirect per image; no lazy loading in print
  const keys = new Set<string>();
  for (const x of sections) for (const mm of (x.body.html ?? "").matchAll(/src="\/api\/files\/manuals\/([^"?#]+)"/g)) keys.add(decodeURIComponent(mm[1]));
  const signed = new Map<string, string>();
  if (keys.size) {
    const { data } = await supabaseAdmin().storage.from("manuals").createSignedUrls([...keys], 600);
    for (const d of data ?? []) if (d.path && d.signedUrl) signed.set(d.path, d.signedUrl);
  }
  // DOC-03: pages kept from the authority's return (approval / signature page as 0.0, stamped LEP in place of ours)
  const ret = ((current as Revision & { return_pages?: { path: string; role: string; page: number }[] | null }).return_pages ?? []);
  const retSigned = new Map<string, string>();
  if (ret.length) { const { data } = await supabaseAdmin().storage.from("manuals").createSignedUrls(ret.map((x) => x.path), 600); for (const d of data ?? []) if (d.path && d.signedUrl) retSigned.set(d.path, d.signedUrl); }
  const approvalPages = ret.filter((x) => x.role === "approval" || x.role === "signature");
  const lepPages = ret.filter((x) => x.role === "lep");
  const shift = (h: string) => h.replace(/<(\/?)h([1-6])(\s|>)/gi, (_m, sl: string, n: string, tail: string) => `<${sl}h${Math.min(6, Number(n) + 2)}${tail}`);
  const fix = (h: string) => shift(h)
    .replace(/src="\/api\/files\/manuals\/([^"?#]+)"/g, (all, k: string) => { const u = signed.get(decodeURIComponent(k)); return u ? `src="${u}"` : all; })
    .replace(/\sloading="lazy"/g, "");

  const parts = partsOf(sections.map((x) => x.ref));
  const partLabel = new Map(parts.map((p) => [p.key, p.label]));
  const ent = ENT[manual.entity];
  const today = new Date().toISOString().slice(0, 10);
  const revLabel = `Issue ${current.issue} · Rev ${current.rev}`;
  const fileName = `${manual.entity}-${manual.code}-Iss${current.issue}-Rev${current.rev}${state === "draft" ? "-DRAFT" : state === "archive" ? "-SUPERSEDED" : ""}`;
  const head = `${ent?.name ?? manual.entity} · ${manual.code} — ${manual.title}`;
  const right = `${revLabel}${current.published_at ? " · " + current.published_at : ""}${state === "draft" ? " · DRAFT" : state === "archive" ? " · SUPERSEDED" : ""}`;
  const foot = state === "published" ? "Uncontrolled copy once downloaded — the current revision is in S.A.M."
    : state === "archive" ? `Superseded by Iss ${supersededBy!.issue} Rev ${supersededBy!.rev}${supersededBy!.published_at ? " (" + supersededBy!.published_at + ")" : ""} — for reference only`
    : `Not approved — ${STEP_LABEL[current.step]} — do not use for operations`;

  await supabaseAdmin().from("audit_log").insert({ actor: s.person?.id ?? null, entity: manual.entity, object_type: "revision", object_id: current.id, action: "download_pdf", after: { code: manual.code, rev: current.rev, step: current.step } });

  const pageCss = `
@page { size: A4; margin: 20mm 15mm 18mm 20mm;
  @top-left { content: ${css(head)}; font: 600 7.5pt Inter, Arial, sans-serif; color: #44546a; vertical-align: bottom; padding-bottom: 3mm; border-bottom: .4pt solid #c9d3dc; }
  @top-right { content: ${css(right)}; font: 600 7.5pt Inter, Arial, sans-serif; color: #44546a; vertical-align: bottom; padding-bottom: 3mm; border-bottom: .4pt solid #c9d3dc; }
  @bottom-left { content: ${css(foot)}; font: 7pt Inter, Arial, sans-serif; color: ${state === "published" ? "#7a8794" : "#b3261e"}; }
  @bottom-right { content: "Page " counter(page) " / " counter(pages); font: 600 7.5pt Inter, Arial, sans-serif; color: #44546a; }
}
@page :first { @top-left { content: none; border: 0 } @top-right { content: none; border: 0 } @bottom-left { content: none } @bottom-right { content: none } }`;

  let lastPart = "";
  return (
    <div className="pm">
      <style dangerouslySetInnerHTML={{ __html: pageCss }} />
      <PrintAuto fileName={fileName} auto={auto === "1"} />
      {state !== "published" && <div className={"pm-wm" + (state === "archive" ? " arch" : "")}>{state === "draft" ? "DRAFT" : "SUPERSEDED"}</div>}

      <section className="pm-cover">
        <div className="pm-ent">{ent?.name ?? manual.entity}<small>{ent?.qual}</small></div>
        <div className="pm-mid">
          <div className="pm-code">{manual.code}</div>
          <div className="pm-title">{manual.title}</div>
          <div className="pm-rev">{revLabel}</div>
          <div className={"pm-state" + (state === "published" ? "" : " draft")}>{state === "published" ? `Published${current.published_at ? " · effective " + current.published_at : ""}` : state === "archive" ? `Superseded by Rev ${supersededBy!.rev} — archive copy` : `${STEP_LABEL[current.step]} — not approved`}</div>
        </div>
        <table className="pm-meta"><tbody>
          <tr><th>Entity</th><td>{ent?.name ?? manual.entity} ({manual.entity})</td></tr>
          <tr><th>Owner</th><td>{manual.owner_role}</td></tr>
          <tr><th>Authority</th><td>{ent?.auth ?? "—"}{current.authority_ref ? ` · ref. ${current.authority_ref}` : ""}{current.authority_route === "approval" ? " · approved before publication" : current.authority_route === "notification" ? " · notified" : ""}</td></tr>
          <tr><th>Downloaded</th><td>{today} by {s.name}</td></tr>
        </tbody></table>
        <p className="pm-note">{state === "archive" ? "Archive copy of a superseded revision, generated from S.A.M. for reference only. It must not be used for operations." : isPublished ? "This copy was generated from S.A.M. and is uncontrolled once downloaded or printed. Always check the current revision in S.A.M. before use." : "Working copy of a revision in progress. It has not been approved and must not be used for operations."}</p>
      </section>

      {approvalPages.map((x) => (
        <section key={x.path} className="pm-scan"><h1 className="pm-scanlab">0.0 · Authority {x.role === "signature" ? "signature page" : "approval"} — {ent?.auth ?? ""}</h1>{retSigned.get(x.path) && <img src={retSigned.get(x.path)} alt="" />}</section>
      ))}
      <section className="pm-front">
        <h1>Record of revisions</h1>
        <table className="pm-tab"><thead><tr><th>Issue / Rev</th><th>Effective</th><th>Summary</th></tr></thead><tbody>
          {!isPublished && <tr className="cur"><td>Iss {current.issue} Rev {current.rev}</td><td>{STEP_LABEL[current.step]}</td><td>{current.summary ?? "—"}</td></tr>}
          {published.map((r) => <tr key={r.id} className={r.id === current.id ? "cur" : ""}><td>Iss {r.issue} Rev {r.rev}</td><td>{r.published_at ?? "—"}</td><td>{r.summary ?? "—"}</td></tr>)}
        </tbody></table>

        {lepPages.length > 0 ? (<>
          <h1>List of effective pages</h1>
          <p className="pm-small">As stamped by {ent?.auth ?? "the authority"} — {lepPages.length} page{lepPages.length === 1 ? "" : "s"} follow.</p>
        </>) : (<>
        <h1>List of effective chapters</h1>
        <table className="pm-tab pm-lec"><thead><tr><th>Chapter</th><th>Title</th><th>Revision</th></tr></thead><tbody>
          {sections.map((x) => (
            <tr key={x.id}><td>{x.ref}</td><td>{x.title}</td><td>{x.changed ? <b>Rev {current.rev} ▌</b> : <span>—</span>}</td></tr>
          ))}
        </tbody></table>
        <p className="pm-small">▌ chapter revised in this revision; changes are marked by a bar in the left margin.</p>
        </>)}
      </section>
      {lepPages.map((x) => <section key={x.path} className="pm-scan">{retSigned.get(x.path) && <img src={retSigned.get(x.path)} alt="" />}</section>)}

      {sections.map((x) => {
        const p = partOf(x.ref); const newPart = p !== lastPart; lastPart = p;
        return (
          <article key={x.id} className={"pm-ch" + (newPart ? " newpart" : "")}>
            {newPart && parts.length > 1 && <h1 className="pm-part">{partLabel.get(p) ?? p}</h1>}
            <h2 className="pm-cht"><span>{x.ref}</span> {x.title}{x.changed && <i className="pm-revtag">revised</i>}</h2>
            <div className="pm-body" dangerouslySetInnerHTML={{ __html: fix(x.body.html ?? `<p>${(x.body.text ?? "").replace(/</g, "&lt;")}</p>`) }} />
          </article>
        );
      })}
    </div>
  );
}

function Denied() {
  return <div style={{ padding: 40, fontFamily: "Inter, Arial, sans-serif" }}><h1 style={{ fontSize: 20, fontWeight: 700 }}>Download restricted</h1><p>The PDF download of a manual is reserved for the accountable manager, nominated persons, compliance / safety managers and their deputies.</p></div>;
}
