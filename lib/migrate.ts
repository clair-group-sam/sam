import { readdirSync, readFileSync } from "fs";
import { join } from "path";

/**
 * Database migrations from the app (Settings › Core): the SQL files of supabase/migrations applied to the project behind
 * NEXT_PUBLIC_SUPABASE_URL through the Supabase Management API, and recorded in supabase_migrations.schema_migrations
 * exactly as the CLI does — so `supabase db push` and this screen stay interchangeable.
 * Needs SUPABASE_ACCESS_TOKEN (personal access token, server only). Preview deployments point at sam-dev, production at sam-prod.
 */
export type Migration = { version: string; name: string; file: string };

export function projectRef(): string {
  const m = /https?:\/\/([a-z0-9]+)\.supabase\.co/i.exec(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  return m?.[1] ?? "";
}
export function localMigrations(): Migration[] {
  const dir = join(process.cwd(), "supabase", "migrations");
  let files: string[] = [];
  try { files = readdirSync(dir).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort(); } catch { return []; }
  return files.map((file) => ({ version: file.slice(0, 14), name: file.slice(15, -4), file }));
}
export function migrationSql(file: string): string {
  if (!/^\d{14}_[\w.-]+\.sql$/.test(file)) throw new Error("Bad migration name");
  return readFileSync(join(process.cwd(), "supabase", "migrations", file), "utf8");
}

export async function runSql(query: string): Promise<{ ok: true; rows: unknown[] } | { ok: false; error: string }> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = projectRef();
  if (!token) return { ok: false, error: "SUPABASE_ACCESS_TOKEN is not set in this environment." };
  if (!ref) return { ok: false, error: "NEXT_PUBLIC_SUPABASE_URL does not name a Supabase project." };
  try {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ query }), cache: "no-store",
    });
    const text = await r.text();
    if (!r.ok) { let msg = text; try { const j = JSON.parse(text) as { message?: string }; msg = j.message ?? text; } catch {} return { ok: false, error: `${r.status} ${msg.slice(0, 600)}` }; }
    let rows: unknown[] = []; try { rows = JSON.parse(text) as unknown[]; } catch {}
    return { ok: true, rows: Array.isArray(rows) ? rows : [] };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** Versions already applied on the project (the CLI's own table; created if the project was never pushed from the CLI). */
export async function appliedVersions(): Promise<{ ok: true; versions: string[] } | { ok: false; error: string }> {
  const r = await runSql("create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text); select version from supabase_migrations.schema_migrations order by version;");
  if (!r.ok) return r;
  return { ok: true, versions: (r.rows as { version: string }[]).map((x) => x.version) };
}

const sqlLit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Applies one migration file and records it. The whole file runs as one request (one transaction on the API side). */
export async function applyMigration(m: Migration): Promise<{ ok: true } | { ok: false; error: string }> {
  const sql = migrationSql(m.file);
  const r = await runSql(sql);
  if (!r.ok) return r;
  const rec = await runSql(`insert into supabase_migrations.schema_migrations (version, name, statements) values (${sqlLit(m.version)}, ${sqlLit(m.name)}, array[${sqlLit(sql)}]) on conflict (version) do nothing;`);
  if (!rec.ok) return { ok: false, error: `Applied, but not recorded: ${rec.error}` };
  return { ok: true };
}
