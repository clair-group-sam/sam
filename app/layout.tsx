import type { ReactNode } from "react";
import "./globals.css";
import { PREF_SCRIPT } from "@/lib/prefs";
export const metadata = { title: "S.A.M. — Safety · Assurance · Management", description: "Clair Group compliance & safety" };
export const viewport = { width: "device-width", initialScale: 1, themeColor: [{ media: "(prefers-color-scheme: light)", color: "#0d2a3f" }, { media: "(prefers-color-scheme: dark)", color: "#0f1a23" }] };
export default function RootLayout({ children }: { children: ReactNode }) {
  return (<html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: PREF_SCRIPT }} /></head><body>{children}</body></html>);
}
