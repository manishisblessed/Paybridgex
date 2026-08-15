export const colors = {
  // Royal Blue — primary Paybridgex brand colour.
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
  // Emerald Green — secondary Paybridgex brand colour.
  accent: {
    50: "#ecfdf5",
    100: "#d1fae5",
    200: "#a7f3d0",
    300: "#6ee7b9",
    400: "#34d399",
    500: "#10b981",
    600: "#059669",
    700: "#047857"
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
  },
  emerald: {
    50: "#ecfdf5",
    100: "#d1fae5",
    500: "#10b981",
    600: "#059669",
    700: "#047857"
  },
  rose: {
    50: "#fff1f2",
    100: "#ffe4e6",
    500: "#f43f5e",
    600: "#e11d48",
    700: "#be123c"
  },
  amber: {
    50: "#fffbeb",
    100: "#fef3c7",
    500: "#f59e0b",
    600: "#d97706",
    700: "#b45309"
  },
  white: "#ffffff",
  black: "#000000",
  bg: "#f5f7fa",
  card: "#ffffff",
  border: "#eaeef4"
};

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32
};

export const shadows = {
  soft: {
    shadowColor: "#0e1626",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4
  },
  glow: {
    shadowColor: colors.brand[600],
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.32,
    shadowRadius: 24,
    elevation: 12
  }
} as const;

export const typography = {
  display: {
    fontFamily: undefined as string | undefined,
    fontWeight: "800" as const
  },
  body: {
    fontFamily: undefined as string | undefined,
    fontWeight: "500" as const
  }
};

export function formatINR(amount: number) {
  return "₹ " + amount.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

export function generateRefId(prefix = "TXN") {
  const date = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}${date}${rand}`;
}
