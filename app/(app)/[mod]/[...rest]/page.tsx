import { notFound } from "next/navigation";
/* FB-022 · any unknown address under a module renders the S.A.M. 404 inside the shell instead of the raw Next.js page. */
export default function Unknown() { notFound(); }
