import { supabaseServer } from "@/lib/supabase-server";
import { scopeFromGroups } from "@/lib/scope";
export default async function Home() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  const groups: string[] = (user?.app_metadata?.groups as string[]) ?? [];
  const scope = scopeFromGroups(groups);
  const { data: tasks } = await sb.from("tasks").select("id,title,due,entity,kind").order("due").limit(20);
  return (<main className="max-w-5xl mx-auto p-8">
    <div className="text-xs uppercase tracking-widest text-slate6">S.A.M. · Inbox</div>
    <h1 className="text-3xl font-bold mt-1">Good morning {user?.user_metadata?.name?.split(" ")[0] ?? ""}</h1>
    <p className="text-slate6 mt-2">Scope: {scope.entities.join(", ") || "none"} · roles: {scope.roles.join(", ") || "none"}</p>
    <section className="mt-8 bg-white border border-line rounded-xl"><table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase text-slate6"><th className="p-3">Entity</th><th>Due</th><th>Item</th><th>Kind</th></tr></thead><tbody>
      {(tasks ?? []).map(t => <tr key={t.id} className="border-t border-line"><td className="p-3 font-mono">{t.entity}</td><td className="font-mono">{t.due}</td><td className="font-semibold">{t.title}</td><td>{t.kind}</td></tr>)}
      {!tasks?.length && <tr><td className="p-6 text-slate6" colSpan={4}>Nothing to do — or RLS hides everything (check your Entra groups).</td></tr>}
    </tbody></table></section></main>);
}
