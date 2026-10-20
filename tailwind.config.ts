import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: { extend: { colors: { navy: "#0d2a3f", cyan: "#12a5e5", slate6: "#5b7183", line: "#dce8f1", bg: "#f2f7fb", terra: "#e20612" } } },
  plugins: [],
} satisfies Config;
