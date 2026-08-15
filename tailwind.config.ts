import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,js,jsx,mdx}"],
  darkMode: "class",
  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: "1rem",
        sm: "1.5rem",
        lg: "2rem",
        xl: "2.5rem"
      },
      screens: {
        "2xl": "1280px"
      }
    },
    extend: {
      colors: {
        // Royal Blue — primary brand colour (matches the Paybridgex logo).
        brand: {
          50: "#eef4ff",
          100: "#d9e6ff",
          200: "#bcd3ff",
          300: "#8db4ff",
          400: "#578bfc",
          500: "#3164f6",
          600: "#1b45ea",
          700: "#1434d0",
          800: "#172ca6",
          900: "#192a82",
          950: "#131b4e"
        },
        // Emerald Green — secondary brand colour (matches the Paybridgex logo).
        accent: {
          50: "#ecfdf5",
          100: "#d1fae5",
          200: "#a7f3d0",
          300: "#6ee7b9",
          400: "#34d399",
          500: "#10b981",
          600: "#059669",
          700: "#047857",
          800: "#065f46",
          900: "#064e3b",
          950: "#022c22"
        },
        ink: {
          50: "#f5f7fa",
          100: "#eaeef4",
          200: "#cfd7e3",
          300: "#a4b3c8",
          400: "#7388a6",
          500: "#516a8c",
          600: "#3f5473",
          700: "#34445d",
          800: "#2e3a4f",
          900: "#0e1626",
          950: "#070b14"
        }
      },
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif"
        ],
        display: [
          "var(--font-display)",
          "ui-sans-serif",
          "system-ui",
          "sans-serif"
        ]
      },
      backgroundImage: {
        "hero-radial":
          "radial-gradient(60% 80% at 50% 0%, rgba(49,100,246,0.18) 0%, rgba(49,100,246,0) 60%), radial-gradient(40% 60% at 100% 100%, rgba(16,185,129,0.12) 0%, rgba(16,185,129,0) 60%)",
        "grid-pattern":
          "linear-gradient(to right, rgba(15,23,42,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(15,23,42,0.06) 1px, transparent 1px)"
      },
      boxShadow: {
        soft: "0 10px 30px -12px rgba(15,23,42,0.18)",
        glow: "0 20px 50px -12px rgba(49,100,246,0.45)"
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" }
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" }
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-12px)" }
        },
        "float-slow": {
          "0%, 100%": { transform: "translate(0,0) rotate(0deg)" },
          "50%": { transform: "translate(20px,-30px) rotate(8deg)" }
        },
        spin3d: {
          "0%": { transform: "rotateY(0deg)" },
          "100%": { transform: "rotateY(360deg)" }
        },
        "pulse-ring": {
          "0%": { transform: "scale(1)", opacity: "0.6" },
          "100%": { transform: "scale(2.2)", opacity: "0" }
        },
        "gradient-x": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" }
        },
        "scroll-y": {
          "0%": { transform: "translateY(0)" },
          "100%": { transform: "translateY(-50%)" }
        }
      },
      animation: {
        "fade-up": "fade-up 0.6s ease-out both",
        marquee: "marquee 30s linear infinite",
        shimmer: "shimmer 2.4s linear infinite",
        float: "float 6s ease-in-out infinite",
        "float-slow": "float-slow 12s ease-in-out infinite",
        spin3d: "spin3d 20s linear infinite",
        "pulse-ring": "pulse-ring 2.4s ease-out infinite",
        "gradient-x": "gradient-x 8s ease infinite",
        "scroll-y": "scroll-y 40s linear infinite"
      }
    }
  },
  plugins: []
};

export default config;
