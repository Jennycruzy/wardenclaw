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
        // WardenClaw editorial theme — high-contrast black/white/grayscale + neon green.
        bg: {
          DEFAULT: "#050505",
          subtle: "#0b0b0b",
          raised: "#101010",
        },
        line: "#242424",
        ink: {
          DEFAULT: "#ffffff",
          muted: "#a3a3a3",
          faint: "#6b6b6b",
        },
        pos: "#00ff88",
        neg: "#fb7185",
        warn: "#fbbf24",
        accent: "#00ff88",
        attack: "#00b36b",
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
