import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { ENT_COLOR } from "@/lib/nav";
import { isAdmin, saveEntity } from "../actions";

/* Settings · Entities: the four organisations of the group, their authority and approvals. Codes are fixed (Teams codes, ENT-01). */
export default async function Entities() {
  const s = await getSession(); if (!s) redirect("/login");
  const admin = await isAdmin(s);
  const { data } = await supabaseAdmin().from("entities").select("*").order("code");
  const rows = (data ?? []) as { code: string; name: string; authority: string; approvals: string[] }[];
  return (
    <>
      <PageHeader eyebrow="Settings, Entities" title="Entities" sub="The organisations S.A.M. serves. The code is fixed (the same as in Teams); the name, the authority and the approvals can be corrected here." />
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))" }}>
        {rows.map((e) => (
          <section key={e.code} className="card" style={{ boxShadow: `inset 0 3px 0 ${ENT_COLOR[e.code] ?? "var(--cyan-ink)"}` }}>
            <div className="ch"><b className="mono">{e.code}</b><span className="mini">{e.authority}</span></div>
            <div className="cb">{admin ? (
              <form action={saveEntity} className="grid gap-2"><input type="hidden" name="code" value={e.code} />
                <label className="block"><span className="eyebrow">Name</span><input name="name" className="inp" defaultValue={e.name} /></label>
                <label className="block"><span className="eyebrow">Authority</span><input name="authority" className="inp mono" defaultValue={e.authority} /></label>
                <label className="block"><span className="eyebrow">Approvals, one per line</span><textarea name="approvals" className="inp" rows={3} defaultValue={(e.approvals ?? []).join("\n")} /></label>
                <div className="flex justify-end"><button className="btn primary" type="submit">Save</button></div></form>
            ) : <><p><b>{e.name}</b></p><p className="mini">{(e.approvals ?? []).join(", ")}</p></>}</div>
          </section>
        ))}
      </div>
    </>
  );
}
