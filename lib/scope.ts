import { normEntity } from "@/lib/entity-codes";
// UX-03: a user sees only the organisation(s) they belong to. Scope is derived from Entra groups CG-<ENTITY>-<ROLE>.
export type Entity = "ASFFR" | "ASJFR" | "ASJMT" | "ASTFR";
export function scopeFromGroups(groups: string[]): { entities: Entity[]; roles: string[]; group: boolean } {
  const entities = new Set<Entity>(); const roles = new Set<string>(); let group = false;
  for (const g of groups) {
    const m = /^CG-(ASFFR|ASJFR|ASJMT|ASTFR|ASF|ASJ|AJD|TEC|GROUP)-([A-Z0-9_]+)$/.exec(g); if (!m) continue; if (m[1] !== "GROUP") m[1] = normEntity(m[1]); // legacy group names (CG-AJD-…) still honoured
    if (m[1] === "GROUP") group = true; else entities.add(m[1] as Entity); roles.add(m[2]);
  }
  return { entities: group ? ["ASFFR", "ASJFR", "ASJMT", "ASTFR"] : [...entities], roles: [...roles], group };
}
