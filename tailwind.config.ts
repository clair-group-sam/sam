import type { Config } from "tailwindcss";
export default { content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"], theme: { extend: { colors: { navy: "#0d2a3f", cyan: "#12a5e5", slate6: "#4a6072", line: "#d6e3ec", bg: "#f2f7fb" } } }, plugins: [] } satisfies Config;
