// /src/sdk/kit.ts
// The consistency kit. Every shot, in every family, reads colour, timing and
// image paths from here. Families change composition; they never change the kit.

import type { ThemeMode } from "./contract";

export interface Palette {
  isDark: boolean;
  bg: string;
  glow: string;
  surface: string;
  surfaceHi: string;
  shadow: string;
  ink: string;
  inkSoft: string;
  rule: string;
  track: string;
  barMuted: string;
  line: string;
  accent: string;
  accentSoft: string;
  accent2: string;
  warn: string;
  scan: string;
}

const LIGHT: Palette = {
  isDark: false,
  bg: "#F4F6F9",
  glow: "radial-gradient(60% 60% at 90% 0%, rgba(0,102,255,0.08), transparent 70%)",
  surface: "#FFFFFF",
  surfaceHi: "#F1F6FF",
  shadow: "0 1.6cqw 3.6cqw rgba(17,24,39,0.10)",
  ink: "#111827",
  inkSoft: "#64748B",
  rule: "rgba(17,24,39,0.10)",
  track: "rgba(17,24,39,0.08)",
  barMuted: "#CBD5E1",
  line: "rgba(17,24,39,0.22)",
  accent: "#0066FF",
  accentSoft: "rgba(0,102,255,0.14)",
  accent2: "#00A3C4",
  warn: "#E53935",
  scan: "rgba(0,102,255,0.10)",
};

const DARK: Palette = {
  isDark: true,
  bg: "#0A0E17",
  glow: "radial-gradient(60% 60% at 80% 0%, rgba(0,102,255,0.18), transparent 70%)",
  surface: "rgba(17,22,31,0.88)",
  surfaceHi: "rgba(30,44,70,0.92)",
  shadow: "0 2.4cqw 5cqw rgba(0,0,0,0.45)",
  ink: "#E5EAF2",
  inkSoft: "rgba(229,234,242,0.60)",
  rule: "rgba(229,234,242,0.12)",
  track: "rgba(229,234,242,0.10)",
  barMuted: "rgba(229,234,242,0.22)",
  line: "rgba(229,234,242,0.26)",
  accent: "#4D9BFF",
  accentSoft: "rgba(77,155,255,0.22)",
  accent2: "#00E5FF",
  warn: "#FF6B66",
  scan: "rgba(77,155,255,0.16)",
};

export function palette(mode: ThemeMode = "light"): Palette {
  return mode === "dark" ? DARK : LIGHT;
}

/** Overshoot easing used for pops and stamps across every family. */
export const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** Shared timing, in frames at 60fps. Every family uses these numbers. */
export const KIT = {
  entry: 16,
  stagger: 8,
  exit: 12,
  cut: 14,
} as const;

/** Logical coordinate space for SVG-based layouts (16:9, 1000 x 560). */
export const STAGE = { w: 1000, h: 560 } as const;

export const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";

export const IMG = {
  hero: "/images/watch-hero.jpg",
  dark: "/images/watch-dark.jpg",
  wrist: "/images/watch-wrist.jpg",
  flatlay: "/images/watch-flatlay.jpg",
} as const;
