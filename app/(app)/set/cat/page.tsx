import { redirect } from "next/navigation";
import { getSession, basePost, NP_ROLES } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Metric, PageHeader } from "@/components/Page";

type P = { id: string; display_name: string; home_entity: string | null; entities: string[] | null; roles: string[] | null; is_group_function: boolean };
const CATS: [string, string][] = [
  ["group", "Group function: every entity by function (CMM, SM, multi-entity AM, CEO, super admin)"],
  ["multi", "Multi-entity post: the entities listed, each justified by a post, a deputy role or a contract"],
  ["staff", "Entity staff: one home entity, sees only it"],
  ["reporter", "Reporter: home entity, own reports, readings and acknowledgements"],
  ["external", "External: guest account, named objects, read-only, with an end date"],
];
function catOf(p: P): string {
  const posts = (p.roles ?? []).map(basePost);
  if (p.is_group_function) return "group";
  if (posts.includes("EXT")) return "external";
  if ((p.entities ?? []).length > 1) return "multi";
  if (posts.some((r) => ["AM", "CMM", "SM", ...NP_ROLES].includes(r))) return "staff";
  return "reporter";
}

/* Settings · User categories & scope (23/09): the five categories, computed from each person's Entra groups. */
export default async function Categories() {
  const s = await getSession(); if (!s) redirect("/login");
  const { data } = await supabaseAdmin().from("people").select("id,display_name,home_entity,entities,roles,is_group_function").order("display_name");
  const all = (data ?? []) as P[];
  const by = new Map<string, P[]>(CATS.map(([k]) => [k, []]));
  for (const p of all) by.get(catOf(p))!.push(p);
  return (
    <>
      <PageHeader eyebrow="Settings, User categories & scope" title="User categories & scope" sub="Every person falls in one category, computed from their Microsoft 365 groups. The scope is reviewed every six months." />
      <div className="grid grid-cols-4 gap-4 mb-5">{CATS.slice(0, 4).map(([k, l]) => <Metric key={k} label={l.split(":")[0]} value={by.get(k)!.length} />)}</div>
      <div className="grid gap-4">{CATS.map(([k, l]) => (
        <section key={k} className="card"><div className="ch"><span className="eyebrow">{l.split(":")[0]}</span><span className="mini">{l.split(": ")[1]}</span></div>
          <div className="cb">{by.get(k)!.length ? <div className="flex flex-wrap gap-2">{by.get(k)!.map((p) => <span key={p.id} className="pill" title={(p.roles ?? []).join(", ")}>{p.display_name}{k === "multi" ? ` (${(p.entities ?? []).join(", ")})` : p.home_entity ? ` (${p.home_entity})` : ""}</span>)}</div> : <p className="mini">Nobody in this category.</p>}</div></section>
      ))}</div>
    </>
  );
}
