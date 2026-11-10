import { addMonths, cycleMonths, KIND_LETTER, monthLabel, STATUS_LABEL, type Audit, type AuditModule, type ProgCheck, type Programme } from "@/lib/audit-programme";
import { addMonthsD, nextDueOf } from "@/lib/compliance-registers";
import { Icon } from "@/lib/icons";

/* AUD-01 · the cycle month by month: one row per module, one chip per audit (P planned · done in green · C checks · A authority; red = month passed, not done; dashed = replanned). */
export function AuditGrid({ p, mods, audits, checks = [], t0 }: { p: Programme; mods: AuditModule[]; audits: Audit[]; checks?: ProgCheck[]; t0: string }) {
  const ms = cycleMonths(p);
  const nowM = t0.slice(0, 7) + "-01";
  // AUD-03 · a "checks" module linked to recurring checks shows their passages (✓ by result) and the next due date; its planned one-off audits are not drawn twice
  const rows: { key: string; code: string; title: string; list: Audit[]; checks: ProgCheck[] }[] = mods.filter((m) => m.active).map((m) => {
    const cks = checks.filter((c) => m.check_ids?.includes(c.id));
    return { key: m.id, code: m.code, title: m.title, list: audits.filter((a) => a.module_id === m.id && (!cks.length || a.status === "closed")), checks: cks };
  });
  const loose = audits.filter((a) => !a.module_id || !mods.some((m) => m.id === a.module_id && m.active));
  if (loose.length) rows.push({ key: "none", code: "Other", title: "audits without module", list: loose, checks: [] });
  const RESULT_CLS: Record<string, string> = { conforming: "closed", partial: "checks", non_conforming: "late" };
  if (!rows.length) return <p className="mini p-4">No module yet, add the areas to audit below.</p>;
  return (
    <div style={{ overflow: "auto" }}>
      <div className="agrid" style={{ gridTemplateColumns: `200px repeat(${ms.length}, minmax(34px, 1fr))` }}>
        <div className="hd" style={{ textAlign: "left" }}>Module</div>
        {ms.map((m, i) => <div key={m} className={"hd" + (m === nowM ? " now" : "")}>{monthLabel(m, i === 0)}</div>)}
        {rows.map((r) => [
          <div key={r.key + "l"} className="lab">{r.code}<div className="mini">{r.title}</div></div>,
          ...ms.map((m) => (
            <div key={r.key + m} className={"cell" + (m === nowM ? " now" : "")}>
              {r.list.filter((a) => a.planned_month === m && a.status !== "cancelled").map((a) => {
                const late = a.status === "planned" && addMonths(a.planned_month, 1) <= t0;
                const cls = a.status === "closed" ? "closed" : late ? "late" : a.kind === "authority" ? "authority" : a.kind === "checks" ? "checks" : "";
                return <a key={a.id} href={`#${a.number}`} className={`au ${cls}${a.replanned ? " repl" : ""}`} aria-label={`${a.number}, ${a.title}, ${STATUS_LABEL[a.status] ?? a.status}${late ? ", month passed" : ""}`} title={`${a.number}, ${a.title}, ${STATUS_LABEL[a.status] ?? a.status}${a.replanned ? `, replanned ×${a.replanned}` : ""}`}>{a.status === "closed" ? <Icon name="check" size={13} /> : late ? `${KIND_LETTER[a.kind] ?? "P"}!` : KIND_LETTER[a.kind] ?? "P"}</a>;
              })}
              {r.checks.flatMap((c) => c.runs.filter((x) => x.done_on.slice(0, 7) + "-01" === m).map((x) => <a key={x.id} href="/comp/checks" className={`au ${RESULT_CLS[x.result] ?? "closed"}`} title={`${c.code} · ${c.title} · ${x.done_on} · ${x.result.replace("_", " ")}`}>✓</a>))}
              {r.checks.map((c) => { // next due: from the check's own passages, else from the last audit done under the module (imported history)
                const lastAudit = r.list.filter((a) => a.status === "closed" && a.done_on).map((a) => a.done_on as string).sort().at(-1) ?? null;
                const nd = nextDueOf(c) ?? (lastAudit ? addMonthsD(lastAudit, c.every_months) : null); if (!nd || nd.slice(0, 7) + "-01" !== m) return null; const late = nd < t0; return <a key={c.id + "nd"} href="/comp/checks" className={`au ${late ? "late" : "checks"}`} title={`${c.code} · ${c.title} · next due ${nd}${late ? " · past due" : ""}`}>C</a>; })}
            </div>
          )),
        ])}
      </div>
      <div className="mini mt-2"><span className="pill">P</span> planned, <span className="pill green"><Icon name="check" size={11} /></span> done, <span className="pill amber">C</span> compliance checks, <span className="pill" style={{ background: "var(--purple-s)", color: "var(--purple)" }}>A</span> authority, <span className="pill red">P!</span> month passed, not done, dashed = replanned</div>
    </div>
  );
}
