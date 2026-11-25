import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/Page";
import WmBridge from "@/components/WmBridge";

export const maxDuration = 300; // a large manual is several hundred pages to chapter and write

export default async function BridgePage() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!(s.roles.includes("CMM") || s.roles.includes("SUPERADMIN"))) redirect("/set/integ");
  return (<>
    <PageHeader eyebrow="Settings, Integrations" title="Web Manuals bridge" sub="Imports a whole Web Manuals root in one run: manuals with their published revision and their draft, certificates and files." />
    <WmBridge />
  </>);
}
