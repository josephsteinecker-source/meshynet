export type Theme = "light" | "dark" | "system";

export type ColorPalette = {
  bg: string;
  bgElevated: string;
  bgHover: string;
  fg: string;
  fgSecondary: string;
  muted: string;
  border: string;
  borderStrong: string;
  accent: string;
  online: string;
  warning: string;
  danger: string;
  inputBg: string;
  inputBorder: string;
  shadow: string;
};

export const BRAND_GRADIENT = {
  start: "#4061ad",
  mid: "#6059a7",
  end: "#2fbebe",
  cssString: "linear-gradient(110deg, #4061ad 0%, #6059a7 45%, #2fbebe 100%)",
};

export const DARK_COLORS: ColorPalette = {
  bg: "#000000",
  bgElevated: "#0a0a0a",
  bgHover: "rgba(255, 255, 255, 0.04)",
  fg: "#ffffff",
  fgSecondary: "rgba(255, 255, 255, 0.85)",
  muted: "rgba(255, 255, 255, 0.55)",
  border: "rgba(255, 255, 255, 0.10)",
  borderStrong: "rgba(255, 255, 255, 0.18)",
  accent: "#2fbebe",
  online: "#30d158",
  warning: "#ff9f0a",
  danger: "#ff453a",
  inputBg: "rgba(255, 255, 255, 0.04)",
  inputBorder: "rgba(255, 255, 255, 0.12)",
  shadow: "0 8px 32px rgba(0, 0, 0, 0.6)",
};

export const LIGHT_COLORS: ColorPalette = {
  bg: "#f5f5f7",
  bgElevated: "#ffffff",
  bgHover: "#fafafa",
  fg: "#1d1d1f",
  fgSecondary: "#3a3a3c",
  muted: "#86868b",
  border: "rgba(0, 0, 0, 0.08)",
  borderStrong: "rgba(0, 0, 0, 0.15)",
  accent: "#0071e3",
  online: "#30b04a",
  warning: "#ff9500",
  danger: "#ff3b30",
  inputBg: "#ffffff",
  inputBorder: "#d2d2d7",
  shadow: "0 8px 32px rgba(0, 0, 0, 0.08)",
};

export const TYPOGRAPHY = {
  h1: {
    fontFamily: "'Fraunces', Georgia, serif",
    fontSize: "clamp(42px, 7vw, 68px)",
    fontWeight: 600,
    letterSpacing: "-0.025em",
    lineHeight: 1.05,
  },
  h2: {
    fontFamily: "'Manrope', sans-serif",
    fontSize: "clamp(28px, 4vw, 36px)",
    fontWeight: 700,
    letterSpacing: "-0.02em",
    lineHeight: 1.2,
  },
  appTitle: {
    fontFamily: "'Manrope', sans-serif",
    fontSize: 32,
    fontWeight: 700,
    letterSpacing: "-0.02em",
  },
  body: {
    fontFamily: "'Manrope', sans-serif",
    fontSize: 15,
    fontWeight: 400,
    lineHeight: 1.5,
  },
  caption: {
    fontFamily: "'Manrope', sans-serif",
    fontSize: 13,
    fontWeight: 500,
  },
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  hero: 64,
} as const;
