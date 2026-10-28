// SPI denominators from Leon: block hours, flight hours and flights per month, per entity (9H- = AJD, F- = ASJ), from the journey log.
import { supabaseAdmin } from "@/lib/supabase-admin";
import { entityOfRegistration, leonGql } from "@/lib/leon";

type F = { flightNid: number; isSimulator: boolean | null; isCnl: boolean | null; startTimeUTC: string | null; acft: { registration: string | null } | null; journeyLog: { bloffUTC: string | null; blonUTC: string | null; toTimeUTC: string | null; ldgTimeUTC: string | null } | null };
export type MonthHours = { entity: string; month: string; bh: number; fh: number; flights: number; noLog: number };

const Q = `query($f: FlightFilter!) { flightList(filter: $f) { flightNid isSimulator isCnl startTimeUTC acft { registration } journeyLog { bloffUTC blonUTC toTimeUTC ldgTimeUTC } } }`;
const h = (a: string | null, b: string | null) => { if (!a || !b) return 0; const d = (new Date(b).getTime() - new Date(a).getTime()) / 3600e3; return d > 0 && d < 20 ? d : 0; };

/** Flown legs of a month (journey log with off-block and on-block), summed per entity. */
export async function leonMonth(month: string): Promise<MonthHours[]> {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1)).toISOString(); const end = new Date(Date.UTC(y, m, 1) - 1000).toISOString();
  const d = await leonGql<{ flightList: F[] }>(Q, { f: { timeInterval: { start, end }, isCnl: false } });
  const by = new Map<string, MonthHours>();
  for (const f of d.flightList ?? []) {
    if (f.isCnl || f.isSimulator) continue;
    const e = entityOfRegistration(f.acft?.registration); if (!e) continue;
    const r = by.get(e) ?? { entity: e, month, bh: 0, fh: 0, flights: 0, noLog: 0 }; by.set(e, r);
    const jl = f.journeyLog; const bh = h(jl?.bloffUTC ?? null, jl?.blonUTC ?? null);
    if (!bh) { r.noLog++; continue; } // not flown / journey log not closed
    r.bh += bh; r.fh += h(jl?.toTimeUTC ?? null, jl?.ldgTimeUTC ?? null) || bh; r.flights++;
  }
  return [...by.values()].map((r) => ({ ...r, bh: Math.round(r.bh * 10) / 10, fh: Math.round(r.fh * 10) / 10 }));
}

/** Writes the months to spi_data (source 'leon'). A value entered by hand ('manual') is kept unless overwrite. */
export async function syncLeonHours(months: string[], opts: { dry?: boolean; overwrite?: boolean } = {}) {
  const db = supabaseAdmin(); const out: (MonthHours & { before?: Record<string, number | null> })[] = [];
  for (const m of months) {
    const rows = await leonMonth(m);
    for (const r of rows) {
      const { data: ex } = await db.from("spi_data").select("key,value,source").eq("entity", r.entity).eq("month", `${m}-01`).in("key", ["bh", "fh", "flights"]);
      const E = new Map(((ex ?? []) as { key: string; value: number; source: string }[]).map((x) => [x.key, x]));
      out.push({ ...r, before: Object.fromEntries(["bh", "fh", "flights"].map((k) => [k, E.get(k)?.value ?? null])) });
      if (opts.dry) continue;
      const ups = (["bh", "fh", "flights"] as const).filter((k) => opts.overwrite || !E.get(k) || E.get(k)!.source === "leon")
        .map((k) => ({ entity: r.entity, key: k, month: `${m}-01`, value: r[k], source: "leon", note: r.noLog ? `${r.noLog} leg(s) without closed journey log` : null, entered_at: new Date().toISOString() }));
      if (ups.length) await db.from("spi_data").upsert(ups, { onConflict: "entity,key,month" });
    }
  }
  return out;
}
