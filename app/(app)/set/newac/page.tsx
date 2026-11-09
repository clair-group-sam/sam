import { redirect } from "next/navigation";

/* Settings · Add an aircraft: the form lives in the aircraft registry. */
export default function AddAircraft() { redirect("/users/fleet?new=1#edit"); }
