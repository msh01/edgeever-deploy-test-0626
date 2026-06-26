import type { Config } from "tailwindcss";

export default {
  content: ["./apps/web/index.html", "./apps/web/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
      },
      boxShadow: {
        panel: "0 1px 2px rgb(15 23 42 / 0.08), 0 12px 30px rgb(15 23 42 / 0.06)",
      },
    },
  },
  plugins: [],
} satisfies Config;
