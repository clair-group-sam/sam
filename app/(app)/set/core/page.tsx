import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { appliedVersions, localMigrations, projectRef } from "@/lib/migrate";
import { applyPending } from "./actions";

/** Settings › Core: the database behind this deployment and its migrations (applied through the Supabase Management API). */
export default async function Core() {
  const s = await getSession();
  if (!s) redirect("/login");
  const admin = s.roles.includes("SUPERADMIN") || s.roles.includes("CMM");
  const local = localMigrations();
  const hasToken = !!process.env.SUPABASE_ACCESS_TOKEN;
  const done = hasToken ? await appliedVersions() : { ok: false as const, error: "SUPABASE_ACCESS_TOKEN is not set in this environment (Vercel › Settings › Environment variables, server only)." };
  const applied = done.ok ? new Set(done.versions) : new Set<string>();
  const pending = done.ok ? local.filter((m) => !applied.has(m.version)) : [];
  const unknown = done.ok ? done.versions.filter((v) => !local.some((m) => m.version === v)) : [];
  const { data: log } = await supabaseAdmin().from("audit_log").select("at,action,after").eq("object_type", "database").order("id", { ascending: false }).limit(10);
  const env = process.env.VERCEL_ENV ?? "local";
  return (
    <>
      <PageHeader eyebrow="Settings · Core" title="Core" sub={`Deployment ${env} · Supabase project ${projectRef() || "?"} · ${local.length} migration files in this build.`} />
      <div className="grid grid-cols-3 gap-4 mb-5">
        <section className="card"><div className="ch"><span className="eyebrow">Database</span><span className={"pill " + (done.ok ? "green" : "amber")}>{done.ok ? "reachable" : "not configured"}</span></div><div className="cb mini">{done.ok ? `${done.versions.length} migration(s) applied on the project.` : done.error}</div></section>
        <section className="card"><div className="ch"><span className="eyebrow">Pending</span><span className={"pill " + (pending.length ? "amber" : "green")}>{pending.length}</span></div><div className="cb mini">{pending.length ? "Migrations in this build not yet applied on the project." : "The project matches this build."}</div></section>
        <section className="card"><div className="ch"><span className="eyebrow">How it works</span></div><div className="cb mini">Same files and same record as <code>supabase db push</code> (table supabase_migrations.schema_migrations): either way can be used. Preview deployments point at sam-dev, production at sam-prod.</div></section>
      </div>
      <section className="card mb-4">
        <div className="ch"><span className="eyebrow">Migrations</span>
          {admin && done.ok && pending.length > 0 && <form action={applyPending}><button className="btn primary" type="submit">Apply {pending.length} pending migration{pending.length > 1 ? "s" : ""}</button></form>}
        </div>
        <table className="tbl"><thead><tr><th>Version</th><th>Name</th><th>Status</th><th /></tr></thead>
          <tbody>
            {local.map((m) => <tr key={m.version}><td className="mono">{m.version}</td><td>{m.name}</td><td>{applied.has(m.version) ? <span className="pill green">applied</span> : done.ok ? <span className="pill amber">pending</span> : <span className="mini">unknown</span>}</td>
              <td className="text-right">{admin && done.ok && !applied.has(m.version) && <form action={applyPending}><input type="hidden" name="up_to" value={m.version} /><button className="btn" type="submit">Apply up to here</button></form>}</td></tr>)}
            {unknown.map((v) => <tr key={v}><td className="mono">{v}</td><td className="mini">applied on the project, not in this build</td><td><span className="pill">project only</span></td><td /></tr>)}
          </tbody></table>
        {!admin && <div className="cb mini">Applying migrations is reserved to Compliance / super admin.</div>}
      </section>
      <section className="card">
        <div className="ch"><span className="eyebrow">Last runs</span></div>
        <table className="tbl"><tbody>
          {((log ?? []) as { at: string; action: string; after: { applied?: string[]; error?: string | null } | null }[]).map((l, i) => <tr key={i}><td className="mono" style={{ width: 170 }}>{l.at.slice(0, 16).replace("T", " ")}</td><td><span className={"pill " + (l.action === "migrations_applied" ? "green" : "red")}>{l.action.replace("migrations_", "")}</span></td><td className="mini">{(l.after?.applied ?? []).join(", ") || "—"}{l.after?.error ? ` · ${l.after.error}` : ""}</td></tr>)}
          {!log?.length && <tr><td className="p-5 text-slate6">No run yet.</td></tr>}
        </tbody></table>
      </section>
    </>
  );
}
