import Link from "next/link";
import type { Session } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ENTS4, ENT } from "@/lib/nav";
import { REGS, cell, type Field } from "@/lib/registers";
import { mayWrite, saveRegisterRow, archiveRegisterRow } from "@/lib/register-actions";

type Row = Record<string, unknown> & { id: string; entity: string };

type Opts = Record<string, [string, string, string][]>; // field → [id, label, entity]
function Input({ f, v, opts, ent }: { f: Field; v: unknown; opts?: Opts; ent?: string }) {
  if (f.type === "ref") { const list = (opts?.[f.k] ?? []).filter((o) => !ent || o[2] === ent); return <select id={`f-${f.k}`} name={f.k} className="inp" defaultValue={(v as string) ?? ""}><option value="">None</option>{list.map(([id, l, e]) => <option key={id} value={id}>{ent ? l : `${l} (${e})`}</option>)}</select>; }
  const common = { id: `f-${f.k}`, name: f.k, className: "inp" + (f.mono ? " mono" : ""), required: f.required, placeholder: f.placeholder };
  if (f.type === "textarea") return <textarea {...common} rows={3} defaultValue={(v as string) ?? ""} />;
  if (f.type === "select") return <select {...common} defaultValue={(v as string) ?? f.options?.[0]?.[0]}>{f.options?.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>;
  if (f.type === "bool") return <select {...common} defaultValue={v === true ? "yes" : v === false ? "no" : ""}><option value="">Not known</option><option value="yes">Yes</option><option value="no">No</option></select>;
  return <input {...common} type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"} defaultValue={v === null || v === undefined ? "" : String(v)} />;
}

function Form({ reg, row, ents, opts }: { reg: string; row: Row | null; ents: string[]; opts: Opts }) {
  const R = REGS[reg];
  return (
    <form action={saveRegisterRow} className="grid gap-3">
      <input type="hidden" name="__reg" value={reg} />
      {row ? <input type="hidden" name="id" value={row.id} /> : ents.length > 1 ? (
        <label className="block" style={{ maxWidth: 260 }}><span className="eyebrow">Entity</span><select name="entity" className="inp" defaultValue={ents[0]}>{ents.map((e) => <option key={e} value={e}>{ENT[e]?.name ?? e}</option>)}</select></label>
      ) : <input type="hidden" name="entity" value={ents[0]} />}
      <div className="grid grid-cols-4 gap-3">
        {R.fields.map((f) => (
          <label key={f.k} className="block" style={{ gridColumn: `span ${f.span ?? 1}` }}>
            <span className="eyebrow">{f.label}</span>
            <Input f={f} v={row?.[f.k]} opts={opts} ent={row?.entity ?? (ents.length === 1 ? ents[0] : undefined)} />
          </label>
        ))}
      </div>
      <div className="flex gap-2 justify-end">
        {row && <Link className="btn" href={R.path}>Cancel</Link>}
        <button className="btn primary" type="submit">{row ? "Save" : `Add the ${R.noun}`}</button>
      </div>
    </form>
  );
}

/**
 * One register: the table of rows in the working entity (or every entity in Group view), a row opens its edit form,
 * "+ New" opens an empty one. Writes go through saveRegisterRow (whitelisted fields, post checked, audit log).
 */
export default async function Register({ reg, s, open, adding, empty, extraFilter }: { reg: string; s: Session; open?: string; adding?: boolean; empty: string; extraFilter?: (r: Row) => boolean }) {
  const R = REGS[reg];
  const scope = s.entity === "ALL" ? (s.group ? null : s.entities) : [s.entity];
  let q = supabaseAdmin().from(R.table).select("*").limit(2000);
  if (scope) q = q.in("entity", scope);
  for (const [c, asc] of R.order) q = q.order(c, { ascending: asc, nullsFirst: false });
  const { data } = await q;
  let rows = ((data ?? []) as Row[]).filter((r) => r.active !== false);
  if (extraFilter) rows = rows.filter(extraFilter);
  const can = await mayWrite(s, R);
  const ents = (scope ?? ENTS4).filter((e) => s.group || s.entities.includes(e));
  const cur = open ? rows.find((r) => r.id === open) ?? null : null;
  const cols = R.list.map((k) => R.fields.find((f) => f.k === k)!).filter(Boolean);
  // "ref" fields: the rows of the other table in the same scope, for the select and for the list cell
  const opts: Opts = {};
  for (const f of R.fields.filter((x) => x.type === "ref" && x.ref)) {
    let oq = supabaseAdmin().from(f.ref!.table).select(`id,entity,${f.ref!.label}`).order(f.ref!.label).limit(3000);
    if (scope) oq = oq.in("entity", scope);
    const { data: od } = await oq;
    opts[f.k] = ((od ?? []) as unknown as Record<string, string>[]).map((o) => [o.id, String(o[f.ref!.label] ?? ""), o.entity]);
  }
  const refLabel = (k: string, v: unknown) => opts[k]?.find((o) => o[0] === v)?.[1] ?? "";
  return (
    <>
      {can && (adding || cur) && (
        <section className="card mb-4" id="edit">
          <div className="ch"><span className="eyebrow">{cur ? `Edit the ${R.noun}` : `New ${R.noun}`}</span>
            {cur && "active" in cur && <form action={archiveRegisterRow}><input type="hidden" name="__reg" value={reg} /><input type="hidden" name="id" value={cur.id} /><button className="btn sm" type="submit">Archive</button></form>}
          </div>
          <div className="cb"><Form reg={reg} row={cur} ents={ents} opts={opts} /></div>
        </section>
      )}
      <section className="card">
        <div className="cb" style={{ padding: 0 }}>
          {!rows.length ? <p className="p-4 mini">{empty}{can ? " Use the button at the top right to add the first one." : ""}</p> : (
            <div style={{ overflowX: "auto" }}><table className="tbl">
              <thead><tr><th className="entcol">Entity</th>{cols.map((c) => <th key={c.k}>{c.label}</th>)}</tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id} className={cur?.id === r.id ? "on" : ""}>
                  <td className="entcol"><span className={"ent " + r.entity}>{r.entity}</span></td>
                  {cols.map((c, i) => {
                    const txt = c.type === "ref" ? refLabel(c.k, r[c.k]) : cell(c, r[c.k]);
                    const tone = R.tone?.[c.k]?.[String(r[c.k])];
                    const inner = tone !== undefined ? <span className={"pill " + tone}>{txt}</span> : <span className={c.mono ? "mono" : ""}>{txt}</span>;
                    return <td key={c.k} className={i ? "mini" : ""}>{i === 0 && can ? <Link href={`${R.path}?open=${r.id}#edit`}><b>{txt || "(untitled)"}</b></Link> : i === 0 ? <b>{txt}</b> : inner}</td>;
                  })}
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      </section>
    </>
  );
}

/** "+ New" button for the page header. */
export async function RegisterAdd({ reg, s }: { reg: string; s: Session }) {
  const R = REGS[reg];
  return (await mayWrite(s, R)) ? <Link className="btn primary" href={`${R.path}?new=1#edit`}>+ New {R.noun}</Link> : null;
}
