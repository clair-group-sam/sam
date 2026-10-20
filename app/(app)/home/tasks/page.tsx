import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";
import { getSession } from "@/lib/session";
import { PageHeader, Metric } from "@/components/Page";
import { ENT } from "@/lib/nav";

type Task = { id: string; title: string; detail: string | null; due: string | null; entity: string; kind: string; status: string };

export default async function Inbox() {
  const s = await getSession();
  if (!s) redirect("/login");
  const sb = await supabaseServer();
  let q = sb.from("tasks").select("id,title,detail,due,entity,kind,status").eq("status", "open").order("due", { ascending: true, nullsFirst: false }).limit(50);
  if (s.entity !== "ALL") q = q.eq("entity", s.entity);
  const { data } = await q;
  const tasks = (data ?? []) as Task[];
  const today = new Date().toISOString().slice(0, 10);
  const late = tasks.filter((t) => t.due && t.due < today).length;
  const first = s.name.split(" ")[0];
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return (
    <>
      <PageHeader eyebrow="S.A.M. · Inbox" title={`${greet} ${first}`} sub="Everything that needs you, in one list." />
      <div className="grid grid-cols-3 gap-4 mb-5">
        <Metric label="Open items" value={tasks.length} hint={s.entity === "ALL" ? "all entities" : ENT[s.entity]?.name} />
        <Metric label="Overdue" value={late} tone={late ? "red" : undefined} hint="past due date" />
        <Metric label="Scope" value={s.group ? "Group" : s.entities.join(" · ") || "—"} hint={s.roles.join(", ") || "no role yet"} />
      </div>
      <section className="card">
        <table className="tbl">
          <thead><tr><th>Entity</th><th>Due</th><th>Item</th><th>Kind</th></tr></thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td><span className={"ent " + t.entity}>{t.entity}</span></td>
                <td className={"mono" + (t.due && t.due < today ? " red" : "")}>{t.due ?? "—"}</td>
                <td><b>{t.title}</b>{t.detail && <div className="mini">{t.detail}</div>}</td>
                <td className="mini">{t.kind}</td>
              </tr>
            ))}
            {!tasks.length && (
              <tr><td colSpan={4} className="p-6 text-slate6">
                {s.person ? "Nothing to do." : "Your account is not yet attached to a person in S.A.M. — ask the CMM to add you."}
              </td></tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
