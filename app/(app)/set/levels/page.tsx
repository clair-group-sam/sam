import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/Page";
import { MODULES, ROLES, SUB, isBuilt, type RoleKey } from "@/lib/nav";

/* Settings · Access levels: what each profile sees, read from the navigation table that drives the menus (single source of truth). */
export default async function AccessLevels() {
  const s = await getSession(); if (!s) redirect("/login");
  const keys = Object.keys(ROLES) as RoleKey[];
  return (
    <>
      <PageHeader eyebrow="Settings, Access levels" title="Access levels" sub="The four profiles and the screens each one reaches. A person's profile follows from their posts (CMM or SM: office; NP: nominated person; AM; everybody else: staff and crew). Data is always filtered by entity on the server." />
      <section className="card"><div className="cb" style={{ padding: 0, overflowX: "auto" }}>
        <table className="tbl"><thead><tr><th>Module, screen</th>{keys.map((k) => <th key={k} style={{ textAlign: "center" }}>{ROLES[k].label}</th>)}</tr></thead><tbody>
          {MODULES.map((m) => (SUB[m.id] ?? []).filter((x) => !x.hidden).map((x, i) => (
            <tr key={m.id + x.id}><td>{i === 0 ? <b>{m.label}</b> : null}<span className={i === 0 ? "mini" : ""} style={{ marginLeft: i === 0 ? 8 : 18 }}>{x.label}</span>{!isBuilt(m.id, x.id) && <span className="soon-tag">soon</span>}</td>
              {keys.map((k) => <td key={k} style={{ textAlign: "center" }}>{(ROLES[k].subs[m.id] ?? []).includes(x.id) ? <span className="pill green">yes</span> : <span className="mini">no</span>}</td>)}</tr>
          )))}
        </tbody></table></div></section>
    </>
  );
}
