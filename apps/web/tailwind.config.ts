import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#0a0e14",
          subtle: "#0e1420",
          raised: "#121a28",
        },
        line: "#1d2738",
        ink: {
          DEFAULT: "#e6edf6",
          muted: "#8b9bb4",
          faint: "#5a6b85",
        },
        pos: "#34d399",
        neg: "#fb7185",
        warn: "#fbbf24",
        accent: "#60a5fa",
        attack: "#a78bfa",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
      },
      boxShadow: {
        card: "0 1px 0 0 rgba(255,255,255,0.02) inset, 0 8px 24px -12px rgba(0,0,0,0.6)",
      },
    },
  },
  plugins: [],
};

export default config;
