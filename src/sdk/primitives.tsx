// /src/sdk/primitives.tsx
// Locked Default Template SDK — Tokens, safe math, springs, and primitive UI.
// Worker LLMs import ONLY from here. No raw CSS positioning allowed.

import { useCallback, useEffect, useRef, useState } from "react";

// ──────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS
// ──────────────────────────────────────────────────────────────────────────────

export const tokens = {
  lightBg: "#F4F6F9",
  darkBg: "#0A0E17",
  darkBg2: "#11161F",
  primaryText: "#111827",
  primaryTextDark: "#E5EAF2",
  electricBlue: "#0066FF",
  coralRed: "#E53935",
  rule: "#E5E7EB",
  ruleDark: "#1F2531",
  inkSoft: "#4B5563",
  fontFamily: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif",
  fontFamilySerif: "'Instrument Serif', ui-serif, Georgia, serif",
  fontFamilyMono: "'JetBrains Mono', ui-monospace, monospace",
};

export type ThemeMode = "light" | "dark";

// ──────────────────────────────────────────────────────────────────────────────
// SAFE MATH HELPERS  (prevents Remotion non-monotonic range crashes)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * safeInterpolate(frame, [inStart, inEnd], [outStart, outEnd])
 * Auto-enforces inEnd = max(inStart + 1, inEnd) so denominator is never 0.
 */
export function safeInterpolate(
  frame: number,
  [inStart, inEnd]: [number, number],
  [outStart, outEnd]: [number, number],
  ease: (t: number) => number = easeOutCubic,
): number {
  const safeInEnd = Math.max(inStart + 1, inEnd);
  const t = Math.max(0, Math.min(1, (frame - inStart) / (safeInEnd - inStart)));
  const et = ease(t);
  return outStart + (outEnd - outStart) * et;
}

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeOutExpo = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Clamp helper */
export const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/** 60fps frame math */
export const FPS = 60;
export const secToFrames = (s: number) => Math.round(s * FPS);
export const framesToSec = (f: number) => f / FPS;

// ──────────────────────────────────────────────────────────────────────────────
// SPRING — useWordSpring
// Standard spring (stiffness: 160, damping: 18) + gaussian blur 10px -> 0px
// ──────────────────────────────────────────────────────────────────────────────

interface SpringState {
  value: number;
  velocity: number;
  blur: number; // 0..10 px
}

export function useWordSpring(localStartFrame: number, currentFrame: number): SpringState {
  // Run the spring deterministically from frame 0..N so every render is reproducible.
  const stiffness = 160;
  const damping = 18;
  const mass = 1;
  const dt = 1 / FPS;

  let value = -40; // entry offset (y px)
  let velocity = 0;
  let blur = 10;

  if (currentFrame < localStartFrame) {
    return { value: -40, velocity: 0, blur: 10 };
  }

  const steps = currentFrame - localStartFrame;
  for (let i = 0; i < steps; i++) {
    const force = -stiffness * value - damping * velocity;
    velocity += (force / mass) * dt;
    value += velocity * dt;
    // blur decays linearly over ~14 frames
    blur = Math.max(0, blur * (1 - 1 / 14));
  }

  return { value, velocity, blur };
}

// ──────────────────────────────────────────────────────────────────────────────
// UI PRIMITIVES — pre-styled, no raw positioning
// ──────────────────────────────────────────────────────────────────────────────

export function FloatingCard({
  title,
  body,
  tone = "neutral",
  mode = "dark",
  accent,
}: {
  title: string;
  body?: string;
  tone?: "neutral" | "blue" | "red";
  mode?: ThemeMode;
  accent?: string;
}) {
  const dark = mode === "dark";
  const borderColor =
    tone === "blue" ? tokens.electricBlue : tone === "red" ? tokens.coralRed : dark ? tokens.ruleDark : tokens.rule;
  return (
    <div
      className="rounded-xl p-4 border backdrop-blur-sm"
      style={{
        background: dark ? "rgba(17,22,31,0.72)" : "rgba(255,255,255,0.82)",
        borderColor,
        color: dark ? tokens.primaryTextDark : tokens.primaryText,
      }}
    >
      {accent && (
        <div
          className="text-[10px] font-mono tracking-[0.2em] uppercase mb-2"
          style={{ color: accent === "blue" ? tokens.electricBlue : accent === "red" ? tokens.coralRed : tokens.inkSoft }}
        >
          {accent}
        </div>
      )}
      <div className="text-sm font-semibold">{title}</div>
      {body && (
        <div
          className="text-xs mt-1 leading-relaxed"
          style={{ color: dark ? "rgba(229,234,242,0.7)" : tokens.inkSoft }}
        >
          {body}
        </div>
      )}
    </div>
  );
}

export function KineticWords({
  words,
  currentFrame,
  mode = "dark",
  highlightIndexes = [],
}: {
  words: { text: string; localStartFrame: number; localSpokenEndFrame: number }[];
  currentFrame: number;
  mode?: ThemeMode;
  highlightIndexes?: { wordIndex: number; tone: "blue" | "red" }[];
}) {
  const dark = mode === "dark";
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 leading-tight">
      {words.map((w, i) => {
        const spring = useWordSpring(w.localStartFrame, currentFrame);
        const highlight = highlightIndexes.find((h) => h.wordIndex === i);
        const color = highlight
          ? highlight.tone === "blue"
            ? tokens.electricBlue
            : tokens.coralRed
          : dark
            ? tokens.primaryTextDark
            : tokens.primaryText;
        return (
          <span
            key={i}
            className="font-serif-italic text-4xl md:text-5xl"
            style={{
              color,
              transform: `translateY(${spring.value}px)`,
              filter: `blur(${spring.blur}px)`,
              display: "inline-block",
              opacity: currentFrame < w.localStartFrame - 1 ? 0 : 1,
            }}
          >
            {w.text}
          </span>
        );
      })}
    </div>
  );
}

export function CounterMetric({
  label,
  target,
  currentFrame,
  startFrame = 0,
  durationFrames = 30,
  suffix = "",
  mode = "dark",
}: {
  label: string;
  target: number;
  currentFrame: number;
  startFrame?: number;
  durationFrames?: number;
  suffix?: string;
  mode?: ThemeMode;
}) {
  const dark = mode === "dark";
  const v = safeInterpolate(currentFrame, [startFrame, startFrame + durationFrames], [0, target]);
  return (
    <div>
      <div
        className="text-[10px] font-mono uppercase tracking-[0.2em] mb-1"
        style={{ color: tokens.electricBlue }}
      >
        {label}
      </div>
      <div
        className="text-5xl font-bold tabular-nums"
        style={{ color: dark ? tokens.primaryTextDark : tokens.primaryText, fontFamily: tokens.fontFamily }}
      >
        {Math.round(v).toLocaleString()}
        <span className="text-2xl ml-1 opacity-60">{suffix}</span>
      </div>
    </div>
  );
}

export function StatusPill({
  label,
  tone = "blue",
  mode = "dark",
}: {
  label: string;
  tone?: "blue" | "red" | "neutral";
  mode?: ThemeMode;
}) {
  const dark = mode === "dark";
  const bg =
    tone === "blue"
      ? "rgba(0,102,255,0.12)"
      : tone === "red"
        ? "rgba(229,57,53,0.12)"
        : dark
          ? "rgba(229,234,242,0.08)"
          : "rgba(17,24,39,0.06)";
  const color =
    tone === "blue" ? tokens.electricBlue : tone === "red" ? tokens.coralRed : dark ? tokens.primaryTextDark : tokens.primaryText;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono uppercase tracking-widest"
      style={{ background: bg, color }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full blink-dot"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

export function ProgressBar({
  currentFrame,
  startFrame = 0,
  durationFrames = 40,
  mode = "dark",
  label,
}: {
  currentFrame: number;
  startFrame?: number;
  durationFrames?: number;
  mode?: ThemeMode;
  label?: string;
}) {
  const dark = mode === "dark";
  const pct = safeInterpolate(currentFrame, [startFrame, startFrame + durationFrames], [0, 100]);
  return (
    <div>
      {label && (
        <div
          className="text-[10px] font-mono uppercase tracking-widest mb-1.5"
          style={{ color: tokens.inkSoft }}
        >
          {label}
        </div>
      )}
      <div
        className="h-1.5 rounded-full overflow-hidden"
        style={{ background: dark ? tokens.ruleDark : tokens.rule }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: tokens.electricBlue }}
        />
      </div>
      <div
        className="text-[10px] font-mono mt-1 tabular-nums"
        style={{ color: tokens.inkSoft }}
      >
        {Math.round(pct)}%
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Frame hook — a requestAnimationFrame driven 60fps clock
// ──────────────────────────────────────────────────────────────────────────────

export function useFrameClock(running: boolean, startFrame = 0, updateFps = FPS) {
  const [frame, setFrameState] = useState(startFrame);
  const rafRef = useRef<number | null>(null);
  const lastPaintRef = useRef(0);
  const frameRef = useRef(startFrame);
  // The clock is (baseFrame + elapsed * 60). A seek re-bases it so manual
  // scrubbing is never overwritten by the next animation frame.
  const baseRef = useRef<{ frame: number; time: number | null }>({ frame: startFrame, time: null });

  const seek = useCallback((next: number) => {
    frameRef.current = next;
    setFrameState(next);
    baseRef.current = { frame: next, time: null };
  }, []);

  useEffect(() => {
    if (!running) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    baseRef.current = { frame: frameRef.current, time: null };
    lastPaintRef.current = 0;
    const interval = 1000 / updateFps;

    const loop = (t: number) => {
      const base = baseRef.current;
      if (base.time === null) {
        base.time = t;
        lastPaintRef.current = t;
      }
      if (t - lastPaintRef.current >= interval - 1) {
        lastPaintRef.current = t;
        const elapsed = (t - base.time) / 1000;
        // Frame values always advance at a true 60fps; only repaint cadence changes.
        const next = base.frame + Math.floor(elapsed * FPS);
        frameRef.current = next;
        setFrameState(next);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [running, updateFps]);

  return { frame, setFrame: seek };
}
