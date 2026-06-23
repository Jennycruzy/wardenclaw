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
        glow: "0 0 0 1px rgba(0,255,136,0.15), 0 0 24px -6px rgba(0,255,136,0.35)",
        "glow-lg": "0 0 0 1px rgba(0,255,136,0.22), 0 0 48px -10px rgba(0,255,136,0.45)",
      },
      keyframes: {
        drift: {
          "0%, 100%": { transform: "translate3d(0,0,0) scale(1)" },
          "50%": { transform: "translate3d(2%,-2%,0) scale(1.08)" },
        },
        "glow-pulse": {
          "0%, 100%": { opacity: "0.55", filter: "drop-shadow(0 0 4px rgba(0,255,136,0.6))" },
          "50%": { opacity: "1", filter: "drop-shadow(0 0 12px rgba(0,255,136,0.95))" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        ticker: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        blink: {
          "0%, 49%": { opacity: "1" },
          "50%, 100%": { opacity: "0" },
        },
      },
      animation: {
        drift: "drift 18s ease-in-out infinite",
        "drift-slow": "drift 26s ease-in-out infinite",
        "glow-pulse": "glow-pulse 2.6s ease-in-out infinite",
        shimmer: "shimmer 2.4s linear infinite",
        ticker: "ticker 40s linear infinite",
        "fade-up": "fade-up 0.4s ease-out both",
        blink: "blink 1.1s step-end infinite",
      },
    },
  },
  plugins: [],
};

export default config;
