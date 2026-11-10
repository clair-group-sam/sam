/* FB-120 · appearance preferences, kept in this browser: theme (light, dark, as the system) and text size. Applied before the first
   paint by the script in app/layout.tsx; this component is the control in the user menu. */
export const PREF_SCRIPT = `try{var t=localStorage.getItem("sam_theme")||"light",z=localStorage.getItem("sam_size")||"standard",d=document.documentElement;d.dataset.theme=t==="auto"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):t;d.dataset.size=z}catch(e){}`;
export function applyPrefs(theme?: string, size?: string) {
  try {
    if (theme) localStorage.setItem("sam_theme", theme);
    if (size) localStorage.setItem("sam_size", size);
    const t = localStorage.getItem("sam_theme") || "light", z = localStorage.getItem("sam_size") || "standard";
    document.documentElement.dataset.theme = t === "auto" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : t;
    document.documentElement.dataset.size = z;
  } catch { /* storage unavailable: the page stays in light, standard size */ }
}
export function readPrefs(): { theme: string; size: string } {
  try { return { theme: localStorage.getItem("sam_theme") || "light", size: localStorage.getItem("sam_size") || "standard" }; } catch { return { theme: "light", size: "standard" }; }
}
