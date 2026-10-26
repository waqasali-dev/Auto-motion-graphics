// src/mg/core.tsx
// Motion-graphics core. Everything is designed inside a fixed 1920x1080
// composition (like an After Effects comp) and scaled to fit as one picture.
// Nothing here is laid out responsively. Positions are pixels in the comp,
// motion comes from keyframes, and every value is a pure function of the frame.

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { ThemeMode } from "../sdk/contract";

export const W = 1920;
export const H = 1080;

export const COLOR = {
  paper: "#F4F6F9",
  ink: "#0B0E14",
  night: "#070A12",
  blue: "#0066FF",
  coral: "#E53935",
  white: "#FFFFFF",
};

export const SANS = "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif";
export const SERIF = "'Instrument Serif', Georgia, serif";

// ──────────────────────────────────────────────────────────────────────────────
// Easing — cubic-bezier curves, the same way a graph editor defines them
// ──────────────────────────────────────────────────────────────────────────────

export type Ease = (t: number) => number;

export function bezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - x;
      const d = dx(t);
      if (Math.abs(err) < 1e-5 || Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    return sy(Math.min(1, Math.max(0, t)));
  };
}

export const E: Record<"linear" | "out" | "inOut" | "in" | "soft" | "back", Ease> = {
  linear: (t: number) => t,
  out: bezier(0.16, 1, 0.3, 1), // fast start, long settle
  inOut: bezier(0.83, 0, 0.17, 1), // snap ease for wipes and camera moves
  in: bezier(0.7, 0, 0.84, 0), // accelerate out of frame
  soft: bezier(0.45, 0, 0.2, 1), // slow camera drift
  back: (t: number) => {
    const c1 = 1.6;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// Keyframes
// ──────────────────────────────────────────────────────────────────────────────

/** [frame, value, easing into this key] */
export type Key = readonly [number, number, Ease?];

export function kf(f: number, keys: readonly Key[]): number {
  if (keys.length === 0) return 0;
  if (f <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [f1, v1, ease] = keys[i];
    if (f <= f1) {
      const [f0, v0] = keys[i - 1];
      const t = (f - f0) / Math.max(1, f1 - f0);
      return v0 + (v1 - v0) * (ease ?? E.out)(t);
    }
  }
  return keys[keys.length - 1][1];
}

export function tw(f: number, at: number, dur: number, from = 0, to = 1, ease: Ease = E.out): number {
  return kf(f, [
    [at, from],
    [at + dur, to, ease],
  ]);
}

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Deterministic pseudo-random in [0, 1). */
export const rand = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Smooth organic drift, like the wiggle() expression. */
export function wiggle(f: number, freq: number, amp: number, seed = 0): number {
  const t = (f / 60) * freq * Math.PI * 2;
  return amp * (Math.sin(t + seed) * 0.5 + Math.sin(t * 1.73 + seed * 1.9) * 0.3 + Math.sin(t * 2.91 + seed * 3.1) * 0.2);
}

/** Camera shake that decays to zero. */
export function shake(f: number, at: number, dur: number, amp: number): { x: number; y: number } {
  if (f < at || f > at + dur) return { x: 0, y: 0 };
  const k = 1 - (f - at) / dur;
  return { x: wiggle(f, 14, amp * k, 1.3), y: wiggle(f, 14, amp * k, 4.1) };
}

/** "40 sec" → ["40", "sec"], "−98%" → ["−98%", ""]. */
export function splitFigure(v: string): [string, string] {
  const m = v.match(/^([−+-]?[\d.,]+%?(?:\s*\/\s*\d+)?)\s*(.*)$/);
  return m ? [m[1], m[2]] : [v, ""];
}

export function splitHeadline(text: string): [string, string] {
  const m = text.match(/^(.*?[.!?])\s+(.*)$/);
  if (m) return [m[1], m[2]];
  const w = text.split(" ");
  const half = Math.ceil(w.length / 2);
  return [w.slice(0, half).join(" "), w.slice(half).join(" ")];
}

export interface Theme {
  dark: boolean;
  bg: string;
  bg2: string;
  ink: string;
  sub: string;
  line: string;
  accent: string;
  accentSoft: string;
}

export function theme(mode: ThemeMode = "light"): Theme {
  return mode === "dark"
    ? {
        dark: true,
        bg: "#070A12",
        bg2: "#0D1530",
        ink: "#F2F5FB",
        sub: "rgba(242,245,251,0.55)",
        line: "rgba(242,245,251,0.14)",
        accent: "#4D94FF",
        accentSoft: "rgba(77,148,255,0.30)",
      }
    : {
        dark: false,
        bg: "#F4F6F9",
        bg2: "#E4EAF4",
        ink: "#0B0E14",
        sub: "rgba(11,14,20,0.50)",
        line: "rgba(11,14,20,0.12)",
        accent: "#0066FF",
        accentSoft: "rgba(0,102,255,0.18)",
      };
}

// ──────────────────────────────────────────────────────────────────────────────
// Motion blur — directional blur scaled by per-frame velocity
// ──────────────────────────────────────────────────────────────────────────────

const MB_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8];

export function FxDefs() {
  return (
    <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
      <defs>
        {MB_LEVELS.map((l) => (
          <g key={l}>
            <filter id={`mbx${l}`} x="-30%" y="-10%" width="160%" height="120%">
              <feGaussianBlur stdDeviation={`${l * 4} 0`} />
            </filter>
            <filter id={`mby${l}`} x="-10%" y="-30%" width="120%" height="160%">
              <feGaussianBlur stdDeviation={`0 ${l * 4}`} />
            </filter>
          </g>
        ))}
        <filter id="mgGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="10" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="mgSoft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="16" />
        </filter>
      </defs>
    </svg>
  );
}

/** Returns a CSS filter for a velocity in comp pixels per frame. */
export function mb(vx: number, vy = 0): string | undefined {
  const ax = Math.abs(vx);
  const ay = Math.abs(vy);
  const lvl = Math.min(8, Math.round(Math.max(ax, ay) / 10));
  if (lvl < 1) return undefined;
  return `url(#${ax >= ay ? "mbx" : "mby"}${lvl})`;
}

/** Trim path, as in a shape layer. Use on SVG paths. */
export function trim(start: number, end: number) {
  const len = Math.max(0, end - start);
  return {
    pathLength: 1,
    strokeDasharray: `${len} 2`,
    strokeDashoffset: -start,
    opacity: len > 0.0005 ? 1 : 0,
  };
}

export function circlePath(cx: number, cy: number, r: number): string {
  return `M ${cx} ${cy - r} a ${r} ${r} 0 1 1 0 ${2 * r} a ${r} ${r} 0 1 1 0 ${-2 * r}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Composition and camera
// ──────────────────────────────────────────────────────────────────────────────

/** A fixed 1920x1080 comp, scaled uniformly to its container like a video. */
export function Composition({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / W);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", overflow: "hidden", background: "#000", ...style }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: W,
          height: H,
          overflow: "hidden",
          transform: `scale(${scale})`,
          transformOrigin: "0 0",
          fontFamily: SANS,
        }}
      >
        <FxDefs />
        {children}
      </div>
    </div>
  );
}

/** 2D camera: frames the world point (fx, fy) at the centre of the comp. */
export function Camera({
  fx,
  fy,
  zoom = 1,
  rot = 0,
  children,
}: {
  fx: number;
  fy: number;
  zoom?: number;
  rot?: number;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: W,
        height: H,
        transformOrigin: "0 0",
        transform: `translate(${W / 2}px, ${H / 2}px) rotate(${rot}deg) scale(${zoom}) translate(${-fx}px, ${-fy}px)`,
      }}
    >
      {children}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Type animators
// ──────────────────────────────────────────────────────────────────────────────

/** Masked rise: the classic track-matte text reveal, with motion blur. */
export function Rise({
  f,
  at,
  dur = 24,
  h = 100,
  out,
  children,
  style,
}: {
  f: number;
  at: number;
  dur?: number;
  h?: number;
  out?: number;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const y = (fr: number) => {
    let v = kf(fr, [
      [at, 108],
      [at + dur, 0, E.out],
    ]);
    if (out !== undefined) {
      v += kf(fr, [
        [out, 0],
        [out + 18, -112, E.in],
      ]);
    }
    return v;
  };
  const v = y(f);
  const vy = ((v - y(f - 1)) * h) / 100;
  return (
    <span
      style={{
        display: "inline-block",
        overflow: "hidden",
        verticalAlign: "bottom",
        padding: "0.06em 0 0.12em",
        margin: "-0.06em 0 -0.12em",
        ...style,
      }}
    >
      <span style={{ display: "inline-block", transform: `translateY(${v}%)`, filter: mb(0, vy) }}>{children}</span>
    </span>
  );
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, "");

/** Word-by-word masked rise. An accent phrase switches to the serif italic. */
export function Words({
  text,
  f,
  at,
  stagger = 4,
  size,
  weight = 800,
  color,
  accent,
  accentColor,
  tracking = -0.045,
  lh = 1.02,
  align = "left",
  width,
  out,
}: {
  text: string;
  f: number;
  at: number;
  stagger?: number;
  size: number;
  weight?: number;
  color: string;
  accent?: string;
  accentColor?: string;
  tracking?: number;
  lh?: number;
  align?: "left" | "center" | "right";
  width?: number;
  out?: number;
}) {
  const words = text.split(" ").filter(Boolean);
  const acc = accent ? accent.split(" ").map(norm) : [];
  const accIdx = new Set<number>();
  if (acc.length) {
    for (let i = 0; i + acc.length <= words.length; i++) {
      if (acc.every((a, k) => norm(words[i + k]) === a)) {
        for (let k = 0; k < acc.length; k++) accIdx.add(i + k);
        break;
      }
    }
  }
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start",
        columnGap: "0.24em",
        width,
        fontSize: size,
        fontWeight: weight,
        color,
        letterSpacing: `${tracking}em`,
        lineHeight: lh,
      }}
    >
      {words.map((w, i) => (
        <Rise key={`${w}-${i}`} f={f} at={at + i * stagger} h={size} out={out === undefined ? undefined : out + i * 2}>
          {accIdx.has(i) ? (
            <span style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400, letterSpacing: "-0.01em", color: accentColor ?? color }}>{w}</span>
          ) : (
            w
          )}
        </Rise>
      ))}
    </div>
  );
}

/** Rolling-digit counter. Each digit spins on its own reel and lands on its value. */
export function Odometer({
  value,
  f,
  at,
  dur = 46,
  size,
  color,
  weight = 800,
  tracking = -0.05,
}: {
  value: string;
  f: number;
  at: number;
  dur?: number;
  size: number;
  color: string;
  weight?: number;
  tracking?: number;
}) {
  const chars = value.split("");
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "flex-start",
        fontSize: size,
        fontWeight: weight,
        color,
        letterSpacing: `${tracking}em`,
        lineHeight: 1,
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      {chars.map((ch, i) => {
        if (!/[0-9]/.test(ch)) {
          return (
            <Rise key={i} f={f} at={at + i * 2} h={size}>
              {ch === " " ? "\u00A0" : ch}
            </Rise>
          );
        }
        const target = (1 + ((chars.length - i) % 3)) * 10 + Number(ch);
        const keys: Key[] = [
          [at + i * 3, 0],
          [at + i * 3 + dur, target, E.out],
        ];
        const pos = kf(f, keys);
        const vel = (pos - kf(f - 1, keys)) * size;
        return (
          <span key={i} style={{ display: "inline-block", height: "1em", overflow: "hidden" }}>
            <span style={{ display: "block", transform: `translateY(${-pos}em)`, filter: mb(0, vel) }}>
              {Array.from({ length: target + 1 }, (_, k) => (
                <span key={k} style={{ display: "block", height: "1em" }}>
                  {k % 10}
                </span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** Lower-third label: a rule draws on, then the caps text rises. */
export function Label({
  text,
  f,
  at,
  color,
  lineColor,
  size = 24,
}: {
  text: string;
  f: number;
  at: number;
  color: string;
  lineColor?: string;
  size?: number;
}) {
  const t = tw(f, at, 26, 0, 1, E.inOut);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <div style={{ width: 64 * t, height: 3, background: lineColor ?? color }} />
      <Rise f={f} at={at + 6} h={size}>
        <span style={{ fontSize: size, fontWeight: 700, letterSpacing: "0.24em", textTransform: "uppercase", color }}>{text}</span>
      </Rise>
    </div>
  );
}

/** Kicker + headline block used as the title layer of a scene. */
export function Heading({
  f,
  at = 0,
  kicker,
  text,
  accent,
  th,
  size = 72,
  width = 1150,
  x = 120,
  y = 96,
  color,
}: {
  f: number;
  at?: number;
  kicker?: string;
  text: string;
  accent?: string;
  th: Theme;
  size?: number;
  width?: number;
  x?: number;
  y?: number;
  color?: string;
}) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width }}>
      {kicker && <Label text={kicker} f={f} at={at} color={th.sub} lineColor={th.accent} />}
      <div style={{ height: 26 }} />
      <Words text={text} f={f} at={at + 6} size={size} weight={700} color={color ?? th.ink} accent={accent} accentColor={th.accent} lh={1.04} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Film finish — grain and vignette over the whole frame
// ──────────────────────────────────────────────────────────────────────────────

let NOISE: string | null = null;

function noiseTile(): string | null {
  if (NOISE !== null) return NOISE;
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(256, 256);
  let s = 1234567;
  for (let i = 0; i < 256 * 256; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const v = (s >> 16) & 255;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  NOISE = c.toDataURL();
  return NOISE;
}

export function FilmFinish({ f, grain = 0.06, vignette = 0.42 }: { f: number; grain?: number; vignette?: number }) {
  const tile = noiseTile();
  return (
    <>
      {tile && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `url(${tile})`,
            backgroundPosition: `${(f * 7919) % 256}px ${(f * 104729) % 256}px`,
            opacity: grain,
            mixBlendMode: "overlay",
            pointerEvents: "none",
            zIndex: 90,
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0,0,0,${vignette}) 100%)`,
          pointerEvents: "none",
          zIndex: 91,
        }}
      />
    </>
  );
}
