import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#0A0E16", soft: "#0E1320" },
        surface: { DEFAULT: "#12161F", 2: "#161B26", 3: "#1B2230" },
        line: { DEFAULT: "#232A38", strong: "#2E3645" },
        fg: {
          DEFAULT: "#C5CDDB",
          heading: "#F4F6FA",
          muted: "#8B94A4",
          faint: "#868F9F",
        },
        accent: {
          DEFAULT: "#EE355E",
          orange: "#F15A24",
          magenta: "#ED1E79",
          soft: "#F58FAC",
        },
      },
      fontFamily: {
        display: ["var(--font-space-grotesk)", "ui-sans-serif", "sans-serif"],
        sans: ["var(--font-inter)", "ui-sans-serif", "sans-serif"],
        mono: ["var(--font-ibm-plex-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        "display-xl": [
          "clamp(2.75rem, 1.9rem + 4.2vw, 4.75rem)",
          { lineHeight: "1.02", letterSpacing: "-0.035em" },
        ],
        "display-l": [
          "clamp(1.875rem, 1.4rem + 2.2vw, 2.75rem)",
          { lineHeight: "1.05", letterSpacing: "-0.03em" },
        ],
        "display-m": [
          "clamp(1.4rem, 1.2rem + 0.9vw, 1.75rem)",
          { lineHeight: "1.1", letterSpacing: "-0.02em" },
        ],
      },
      backgroundImage: {
        "brand-gradient":
          "linear-gradient(115deg, #F15A24 0%, #EE355E 52%, #ED1E79 100%)",
        "brand-gradient-soft":
          "linear-gradient(115deg, rgba(241,90,36,0.16) 0%, rgba(237,30,121,0.16) 100%)",
      },
      maxWidth: {
        content: "1180px",
        prose: "62ch",
      },
      keyframes: {
        "node-travel": {
          "0%": { offsetDistance: "8%", opacity: "0.65" },
          "50%": { offsetDistance: "92%", opacity: "1" },
          "100%": { offsetDistance: "8%", opacity: "0.65" },
        },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-node": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
      },
      animation: {
        "node-travel": "node-travel 7s ease-in-out infinite",
        "fade-up": "fade-up 0.6s ease-out both",
        "pulse-node": "pulse-node 3.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
