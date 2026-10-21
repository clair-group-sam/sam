import { getSession } from "@/lib/session";
import { listModels, writeModel } from "@/lib/ai";
/** Registers › AI: which models the group's key can use, and which one S.A.M. writes with. SUPERADMIN / CMM only. */
export async function GET() {
  const s = await getSession();
  if (!s || !(s.roles.includes("SUPERADMIN") || s.roles.includes("CMM"))) return new Response("forbidden", { status: 403 });
  const models = await listModels();
  return Response.json({ writing_with: await writeModel(), override: process.env.AI_MODEL_WRITE ?? null, models: models.map((m) => ({ id: m.id, name: m.display_name, created_at: m.created_at })) });
}
