import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: { extend: { colors: { navy: "var(--navy)", cyan: "var(--cyan)", slate6: "var(--slate6)", line: "var(--line)", bg: "#f2f7fb", terra: "var(--terra)", white: "var(--white)" } } },
  plugins: [],
} satisfies Config;
