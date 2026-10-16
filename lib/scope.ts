// UX-03: a user sees only the organisation(s) they belong to. Scope is derived from Entra groups CG-<ENTITY>-<ROLE>.
export type Entity = "ASF" | "ASJ" | "AJD" | "TEC";
export function scopeFromGroups(groups: string[]): { entities: Entity[]; roles: string[]; group: boolean } {
  const entities = new Set<Entity>(); const roles = new Set<string>(); let group = false;
  for (const g of groups) {
    const m = /^CG-(ASF|ASJ|AJD|TEC|GROUP)-([A-Z0-9_]+)$/.exec(g); if (!m) continue;
    if (m[1] === "GROUP") group = true; else entities.add(m[1] as Entity); roles.add(m[2]);
  }
  return { entities: group ? ["ASF", "ASJ", "AJD", "TEC"] : [...entities], roles: [...roles], group };
}
