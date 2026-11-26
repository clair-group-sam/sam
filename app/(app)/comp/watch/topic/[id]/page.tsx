import { redirect } from "next/navigation";
export default async function Moved({ params }: { params: Promise<{ id: string }> }) { redirect(`/reg/watch/topic/${(await params).id}`); }
