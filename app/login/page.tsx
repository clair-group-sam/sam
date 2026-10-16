"use client";
import { supabaseBrowser } from "@/lib/supabase-browser";
export default function Login() {
  const signIn = () => supabaseBrowser().auth.signInWithOAuth({ provider: "azure", options: { scopes: "openid profile email", redirectTo: `${location.origin}/auth/callback` } });
  return (<main className="min-h-screen grid place-items-center"><div className="bg-white border border-line rounded-xl p-10 w-[420px] text-center shadow-sm">
    <div className="text-3xl font-extrabold tracking-tight">S.A.M.</div><div className="text-slate6 text-sm mt-1">Safety · Assurance · Management</div>
    <button onClick={signIn} className="mt-8 w-full rounded-md bg-navy text-white py-3 font-semibold">Sign in with Microsoft</button>
    <p className="text-xs text-slate6 mt-4">Clair Group accounts only (Entra ID).</p></div></main>);
}
