import "./globals.css";
export const metadata = { title: "S.A.M. — Safety · Assurance · Management", description: "Clair Group compliance & safety" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
