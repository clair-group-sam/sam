import { redirect } from "next/navigation";
/** MOCs are risk assessments of kind "moc" (risk register v2): their page is the assessment page. */
export default async function MocRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/safe/risk/a/${id}`);
}
