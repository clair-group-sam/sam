"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
function LoginCard() {
  const setup = useSearchParams().get("setup") === "1";
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const signIn = () => supabaseBrowser().auth.signInWithOAuth({ provider: "azure", options: { scopes: "openid profile email", redirectTo: `${location.origin}/auth/callback` } });
  return (<div className="bg-white border border-line rounded-xl p-10 w-[420px] text-center shadow-sm">
    <div className="text-3xl font-extrabold tracking-tight">S.A.M.</div><div className="text-slate6 text-sm mt-1">Safety · Assurance · Management</div>
    {configured
      ? <button onClick={signIn} className="mt-8 w-full rounded-md bg-navy text-white py-3 font-semibold">Sign in with Microsoft</button>
      : <div className="mt-8 rounded-md border border-amber-300 bg-amber-50 text-amber-900 text-sm p-4 text-left">
          <b>Deployment OK — database not connected yet.</b><br/>Add the Supabase environment variables in Vercel, then redeploy.{setup ? "" : ""}
        </div>}
    <p className="text-xs text-slate6 mt-4">Clair Group accounts only (Entra ID).</p></div>);
}
export default function Login() {
  return (<main className="min-h-screen grid place-items-center"><Suspense fallback={null}><LoginCard /></Suspense></main>);
}
