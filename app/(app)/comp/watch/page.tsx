import { redirect } from "next/navigation";
/** Regulatory watch moved under Regulation (26/11): old links (tasks, e-mails) still land on it. */
export default function Moved() { redirect("/reg/watch"); }
