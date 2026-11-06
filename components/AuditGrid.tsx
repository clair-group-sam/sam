import { addMonths, cycleMonths, KIND_LETTER, monthLabel, STATUS_LABEL, type Audit, type AuditModule, type Programme } from "@/lib/audit-programme";
import { Icon } from "@/lib/icons";

/* AUD-01 · the cycle month by month: one row per module, one chip per audit (P planned · done in green · C checks · A authority; red = month passed, not done; dashed = replanned). */
export function AuditGrid({ p, mods, audits, t0 }: { p: Programme; mods: AuditModule[]; audits: Audit[]; t0: string }) {
  const ms = cycleMonths(p);
  const nowM = t0.slice(0, 7) + "-01";
  const rows: { key: string; code: string; title: string; list: Audit[] }[] = mods.filter((m) => m.active).map((m) => ({ key: m.id, code: m.code, title: m.title, list: audits.filter((a) => a.module_id === m.id) }));
  const loose = audits.filter((a) => !a.module_id || !mods.some((m) => m.id === a.module_id && m.active));
  if (loose.length) rows.push({ key: "none", code: "Other", title: "audits without module", list: loose });
  if (!rows.length) return <p className="mini p-4">No module yet — add the areas to audit below.</p>;
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
                return <a key={a.id} href={`#${a.number}`} className={`au ${cls}${a.replanned ? " repl" : ""}`} title={`${a.number} · ${a.title} · ${STATUS_LABEL[a.status] ?? a.status}${a.replanned ? ` · replanned ×${a.replanned}` : ""}`}>{a.status === "closed" ? <Icon name="check" size={11} /> : KIND_LETTER[a.kind] ?? "P"}</a>;
              })}
            </div>
          )),
        ])}
      </div>
      <div className="mini mt-2"><span className="pill">P</span> planned · <span className="pill green"><Icon name="check" size={11} /></span> done · <span className="pill amber">C</span> compliance checks · <span className="pill" style={{ background: "var(--purple-s)", color: "var(--purple)" }}>A</span> authority · <span className="pill red">P</span> month passed, not done · dashed = replanned</div>
    </div>
  );
}
