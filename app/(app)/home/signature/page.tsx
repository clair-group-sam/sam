import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/Page";
import { frdt } from "@/lib/dates";
import { SIGN_BUCKET } from "@/lib/signature";
import { removeSignature, saveSignature } from "./actions";

/* SIG-01 · My signature (opened from the menu under the name): the image of my handwritten signature, uploaded by me, placed by S.A.M.
 * on the documents that ask for a handwritten signature, and only where I signed in S.A.M. */
export default async function MySignature({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const s = await getSession(); if (!s) redirect("/login");
  const { msg } = await searchParams; const db = supabaseAdmin();
  const { data } = s.person ? await db.from("people").select("signature_path,signature_at").eq("id", s.person.id).maybeSingle() : { data: null };
  const p = data as { signature_path: string | null; signature_at: string | null } | null;
  const { data: signed } = p?.signature_path && !s.viewAs ? await db.storage.from(SIGN_BUCKET).createSignedUrl(p.signature_path, 120) : { data: null };
  return (
    <>
      <PageHeader eyebrow="Home, My signature" title="My signature" sub="The image of your handwritten signature. S.A.M. places it on the documents that ask for a handwritten signature, and only where you have signed in S.A.M. yourself." />
      {msg && <div className="card mb-4"><div className="cb">{msg}</div></div>}
      {s.viewAs ? <div className="card"><div className="cb">You are looking at S.A.M. as another profile: a signature is only seen and uploaded by its owner. Go back to your own view.</div></div> : !s.person ? <div className="card"><div className="cb">Your account is not attached to a person in S.A.M. yet.</div></div> : (
        <>
          <section className="card mb-4">
            <div className="ch"><span className="eyebrow">Current signature</span>{p?.signature_at && <span className="mini">uploaded {frdt(p.signature_at)}</span>}</div>
            <div className="cb">
              {signed?.signedUrl ? <>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={signed.signedUrl} alt="Your handwritten signature" style={{ maxHeight: 110, maxWidth: 380, background: "#fff", border: "1px solid var(--line)", padding: 8 }} />
                <form action={removeSignature} className="mt-3"><button className="btn" type="submit">Remove my signature</button></form></>
                : <p className="text-slate6">No signature uploaded. Where you sign, documents show your name, your function and the date.</p>}
            </div>
          </section>
          <section className="card mb-4">
            <div className="ch"><span className="eyebrow">{p?.signature_path ? "Replace it" : "Upload it"}</span></div>
            <form action={saveSignature} className="cb flex flex-wrap gap-3 items-end">
              <label><span className="mini">Image of the signature alone, PNG or JPEG, 400 KB at most (a white or transparent background reads best)</span><input type="file" name="file" accept="image/png,image/jpeg" className="inp" required /></label>
              <button className="btn primary" type="submit">Save</button>
            </form>
          </section>
          <section className="card"><div className="cb mini">
            <p><b>How it is used.</b> Signing in S.A.M. stays the click of the signed-in person, written in the audit log that cannot be changed. The image is only the handwritten form of that signature on a document. It is kept in private storage, shown on this page to you alone, and never placed on a document you did not sign.</p>
            <p className="mt-2"><b>Where.</b> Today: the competency assessment sheets, for the assessor. The approval pages of the manuals and the forms for the authority that ask for a handwritten signature follow, document by document.</p>
          </div></section>
        </>
      )}
    </>
  );
}
