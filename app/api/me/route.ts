import { getSession } from "@/lib/session";
/** Who am I, as S.A.M. sees me (debug for the beta: scope, roles, entity). */
export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ signedIn: false }, { status: 401 });
  const { person, ...rest } = s;
  return Response.json({ signedIn: true, ...rest, personFound: !!person });
}
