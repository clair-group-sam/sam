import type { SupabaseClient } from "@supabase/supabase-js";

/* SIG-01 (24/11) · the handwritten signature of a person: an image they upload themselves, kept in private storage. S.A.M. places it
 * only where that person has signed in S.A.M. (the click of the signed-in person, written in the chained audit log, is the signature;
 * the image is its handwritten form on the documents that ask for one). Never shown to anyone else on a screen. */
export const SIGN_BUCKET = "evidence";
export const signPath = (personId: string) => `signatures/${personId}`;
export const SIGN_MAX = 400 * 1024;
export const SIGN_TYPES = ["image/png", "image/jpeg"];

/** The signature of a person as a data URI, to print it on a document they signed; null when they have not uploaded one. */
export async function signatureDataUri(db: SupabaseClient, personId: string | null | undefined): Promise<string | null> {
  if (!personId) return null;
  const { data: p } = await db.from("people").select("signature_path").eq("id", personId).maybeSingle();
  const path = (p as { signature_path: string | null } | null)?.signature_path; if (!path) return null;
  const { data, error } = await db.storage.from(SIGN_BUCKET).download(path); if (error || !data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  const type = buf[0] === 0x89 && buf[1] === 0x50 ? "image/png" : "image/jpeg";
  return `data:${type};base64,${buf.toString("base64")}`;
}
