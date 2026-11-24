"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { SIGN_BUCKET, SIGN_MAX, SIGN_TYPES, signPath } from "@/lib/signature";

const back = (m: string) => redirect(`/home/signature?msg=${encodeURIComponent(m)}`);

/** SIG-01 · a person uploads the image of their own handwritten signature. Nobody can do it for someone else, not even in "View as". */
export async function saveSignature(fd: FormData) {
  const s = await getSession(); if (!s?.person) return;
  if (s.viewAs) back("Leave “View as” first: a signature is only uploaded by its owner, in their own session.");
  const f = fd.get("file");
  if (!(f instanceof File) || !f.size) back("Choose an image first.");
  const file = f as File;
  if (!SIGN_TYPES.includes(file.type)) back("PNG or JPEG only.");
  if (file.size > SIGN_MAX) back("Image larger than 400 KB: crop it to the signature alone.");
  const bin = Buffer.from(await file.arrayBuffer());
  const png = bin[0] === 0x89 && bin[1] === 0x50 && bin[2] === 0x4e && bin[3] === 0x47; const jpg = bin[0] === 0xff && bin[1] === 0xd8;
  if (!png && !jpg) back("This file is not a PNG or JPEG image.");
  const db = supabaseAdmin(); const path = signPath(s.person!.id);
  const up = await db.storage.from(SIGN_BUCKET).upload(path, bin, { contentType: png ? "image/png" : "image/jpeg", upsert: true });
  if (up.error) back("The image could not be saved: " + up.error.message);
  const at = new Date().toISOString();
  await db.from("people").update({ signature_path: path, signature_at: at }).eq("id", s.person!.id);
  await db.from("audit_log").insert({ actor: s.person!.id, entity: null, object_type: "person", object_id: s.person!.id, action: "signature_image_uploaded", after: { bytes: bin.length, type: png ? "png" : "jpeg" } });
  revalidatePath("/home/signature"); back("Signature saved.");
}

export async function removeSignature() {
  const s = await getSession(); if (!s?.person || s.viewAs) return;
  const db = supabaseAdmin();
  await db.storage.from(SIGN_BUCKET).remove([signPath(s.person.id)]);
  await db.from("people").update({ signature_path: null, signature_at: null }).eq("id", s.person.id);
  await db.from("audit_log").insert({ actor: s.person.id, entity: null, object_type: "person", object_id: s.person.id, action: "signature_image_removed" });
  revalidatePath("/home/signature"); back("Signature removed. Documents already produced keep it; new ones will show your name and the date only.");
}
