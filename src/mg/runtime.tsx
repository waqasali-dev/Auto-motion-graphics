// Low-level, Remotion-safe motion primitives exposed to generated components.
// These are drawing tools, not scene templates: the model composes every shot.

import React, { type CSSProperties, type ReactNode } from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  random,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { WordCue } from "../sdk/contract.generated";

const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };

export function WordCueMark({
  cue,
  children,
  style,
  emphasisColor = "#0066ff",
  emphasis = false,
  entryFrames = 10,
}: {
  cue: WordCue;
  children?: ReactNode;
  style?: CSSProperties;
  emphasisColor?: string;
  emphasis?: boolean;
  entryFrames?: number;
}) {
  const frame = useCurrentFrame();
  // Pipeline middleware already subtracts the 4-frame vocal pre-roll.
  const start = Math.max(0, cue.startFrame);
  const duration = Math.max(1, Math.min(entryFrames, cue.spokenEndFrame - start));
  const p = interpolate(frame, [start, start + duration], [0, 1], clamp);
  const opacity = interpolate(frame, [start, start + Math.min(5, duration)], [0, 1], clamp);
  return (
    <span
      data-word-index={cue.wordIndex}
      style={{
        display: "inline-block",
        opacity,
        transform: `translateY(${(1 - p) * 18}px) scale(${0.96 + p * 0.04})`,
        filter: `blur(${(1 - p) * 6}px)`,
        color: emphasis ? emphasisColor : undefined,
        willChange: "transform, opacity, filter",
        ...style,
      }}
    >
      {children ?? cue.text}
    </span>
  );
}

export function CueProgress({ cue, width = 260, color = "#0066ff", height = 4 }: { cue: WordCue; width?: number; color?: string; height?: number }) {
  const frame = useCurrentFrame();
  const end = Math.max(cue.startFrame + 1, cue.spokenEndFrame);
  const p = interpolate(frame, [cue.startFrame, end], [0, 1], clamp);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <rect width={width} height={height} rx={height / 2} fill="rgba(127,127,127,.25)" />
      <rect width={width * p} height={height} rx={height / 2} fill={color} />
    </svg>
  );
}

export function WordRoll({
  value,
  from = 0,
  to,
  fontSize = 120,
  color = "#111827",
  style,
}: {
  value?: number;
  from?: number;
  to: number;
  fontSize?: number;
  color?: string;
  style?: CSSProperties;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - 4, fps, config: { stiffness: 110, damping: 18, mass: 0.8 } });
  const n = value ?? Math.round(from + (to - from) * p);
  return (
    <span style={{ fontSize, fontWeight: 800, lineHeight: 0.9, letterSpacing: "-0.06em", fontVariantNumeric: "tabular-nums", color, ...style }}>
      {n.toLocaleString()}
    </span>
  );
}

export function StrokeReveal({
  d,
  width,
  height,
  color = "#0066ff",
  strokeWidth = 5,
  startFrame = 0,
  durationFrames = 48,
  fill = "none",
  style,
}: {
  d: string;
  width: number;
  height: number;
  color?: string;
  strokeWidth?: number;
  startFrame?: number;
  durationFrames?: number;
  fill?: string;
  style?: CSSProperties;
}) {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [startFrame, startFrame + Math.max(1, durationFrames)], [0, 1], clamp);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: "visible", ...style }}>
      <path d={d} fill={fill} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1 2" strokeDashoffset={1 - p} />
    </svg>
  );
}

export function CameraRig({
  children,
  x = 0,
  y = 0,
  zoom = 1,
  rotation = 0,
  origin = "50% 50%",
  style,
}: {
  children: ReactNode;
  x?: number;
  y?: number;
  zoom?: number;
  rotation?: number;
  origin?: string;
  style?: CSSProperties;
}) {
  return (
    <AbsoluteFill
      style={{
        transform: `translate(${x}px, ${y}px) scale(${zoom}) rotate(${rotation}deg)`,
        transformOrigin: origin,
        ...style,
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

export function ImpactLine({ text, frameAt = 0, color = "#111827", size = 72, style }: { text: string; frameAt?: number; color?: string; size?: number; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - frameAt, fps, config: { stiffness: 160, damping: 20 } });
  const opacity = interpolate(frame, [frameAt, frameAt + 8], [0, 1], clamp);
  return (
    <span style={{ display: "inline-block", opacity, transform: `translateY(${(1 - p) * 42}px) scale(${0.94 + p * 0.06})`, filter: `blur(${(1 - opacity) * 8}px)`, fontSize: size, fontWeight: 750, lineHeight: 1, letterSpacing: "-0.045em", color, ...style }}>
      {text}
    </span>
  );
}

export function Marker({
  x = 0,
  y = 0,
  size = 16,
  color = "#0066ff",
  variant = "cross",
  style,
}: {
  x?: number;
  y?: number;
  size?: number;
  color?: string;
  variant?: "cross" | "dot" | "circle" | "corner";
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
        pointerEvents: "none",
        ...style,
      }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {variant === "cross" && (
          <>
            <line x1={size / 2} y1={0} x2={size / 2} y2={size} stroke={color} strokeWidth={1.5} />
            <line x1={0} y1={size / 2} x2={size / 2} y2={size} stroke={color} strokeWidth={1.5} />
          </>
        )}
        {variant === "dot" && <circle cx={size / 2} cy={size / 2} r={size / 3} fill={color} />}
        {variant === "circle" && <circle cx={size / 2} cy={size / 2} r={size / 2 - 1} fill="none" stroke={color} strokeWidth={1.5} />}
        {variant === "corner" && (
          <path d={`M0,${size / 2} L0,0 L${size / 2},0`} fill="none" stroke={color} strokeWidth={1.5} />
        )}
      </svg>
    </div>
  );
}

export function Noise({ opacity = 0.04, style }: { opacity?: number; style?: CSSProperties }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        opacity,
        background: "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.06), transparent 80%)",
        mixBlendMode: "overlay",
        ...style,
      }}
    />
  );
}

export function FocusFrame({
  frameAt = 0,
  color = "#FF5500",
  strokeWidth = 3,
  borderRadius = 14,
  padding = 0,
  pulse = true,
  children,
  style,
}: {
  frameAt?: number;
  color?: string;
  strokeWidth?: number;
  borderRadius?: number;
  padding?: number | string;
  pulse?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - frameAt, fps, config: { stiffness: 180, damping: 16 } });
  const opacity = interpolate(frame, [frameAt, frameAt + 6], [0, 1], clamp);
  const pulseScale = pulse && frame > frameAt + 16 ? 1 + 0.015 * Math.sin((frame - frameAt) * 0.18) : 1;

  return (
    <div
      style={{
        display: "inline-block",
        position: "relative",
        borderRadius,
        border: `${strokeWidth}px solid ${color}`,
        padding,
        opacity,
        transform: `scale(${(0.92 + p * 0.08) * pulseScale})`,
        boxShadow: `0 0 ${16 * p}px ${color}33`,
        transition: "none",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function GridBackground({
  mode = "dark",
  gridSize = 48,
  lineColor,
  dots = false,
  style,
}: {
  mode?: "dark" | "light";
  gridSize?: number;
  lineColor?: string;
  dots?: boolean;
  style?: CSSProperties;
}) {
  const isDark = mode === "dark";
  const defaultLine = isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.06)";
  const color = lineColor ?? defaultLine;
  const bg = isDark ? "#0B0D13" : "#F8FAFC";

  const pattern = dots
    ? `radial-gradient(${color} 1.5px, transparent 1.5px)`
    : `linear-gradient(${color} 1px, transparent 1px), linear-gradient(90deg, ${color} 1px, transparent 1px)`;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: bg,
        backgroundImage: pattern,
        backgroundSize: `${gridSize}px ${gridSize}px`,
        pointerEvents: "none",
        ...style,
      }}
    />
  );
}

export function Card({
  frameAt = 4,
  tilt = 0,
  width = 720,
  height,
  mode = "dark",
  borderRadius = 24,
  children,
  style,
}: {
  frameAt?: number;
  tilt?: number;
  width?: number | string;
  height?: number | string;
  mode?: "dark" | "light";
  borderRadius?: number;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - frameAt, fps, config: { stiffness: 160, damping: 15, mass: 0.8 } });
  const isDark = mode === "dark";
  const bg = isDark ? "#12151D" : "#FFFFFF";
  const border = isDark ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(0,0,0,0.08)";
  const shadow = isDark ? "0 30px 80px rgba(0,0,0,0.55)" : "0 30px 80px rgba(0,0,0,0.18)";

  return (
    <div
      style={{
        width,
        height,
        borderRadius,
        background: bg,
        border,
        boxShadow: shadow,
        transform: `translateY(${(1 - p) * 60}px) scale(${0.92 + p * 0.08}) rotate(${tilt}deg)`,
        opacity: interpolate(frame, [frameAt, frameAt + 8], [0, 1], clamp),
        position: "relative",
        boxSizing: "border-box",
        overflow: "hidden",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Heading({
  title,
  kicker,
  frameAt = 2,
  size = 56,
  color,
  kickerColor = "#0066ff",
  style,
}: {
  title: string;
  kicker?: string;
  frameAt?: number;
  size?: number;
  color?: string;
  kickerColor?: string;
  style?: CSSProperties;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - frameAt, fps, config: { stiffness: 160, damping: 18 } });
  const opacity = interpolate(frame, [frameAt, frameAt + 8], [0, 1], clamp);

  return (
    <div
      style={{
        transform: `translateY(${(1 - p) * 24}px)`,
        opacity,
        ...style,
      }}
    >
      {kicker && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span style={{ width: 28, height: 2, background: kickerColor }} />
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: kickerColor }}>
            {kicker}
          </span>
        </div>
      )}
      <h2 style={{ fontSize: size, fontWeight: 750, letterSpacing: "-0.035em", lineHeight: 1.08, margin: 0, color: color ?? undefined }}>
        {title}
      </h2>
    </div>
  );
}

/** The generated-code surface. Keep this low-level; it contains no layouts. */
export const mg = Object.freeze({
  WordCue: WordCueMark,
  CueProgress,
  Roll: WordRoll,
  Stroke: StrokeReveal,
  Sweep: StrokeReveal,
  CameraRig,
  ImpactLine,
  Marker,
  Noise,
  FocusFrame,
  Callout: FocusFrame,
  GridBackground,
  Grid: GridBackground,
  Card,
  Heading,
  AbsoluteFill,
  interpolate,
  spring,
  Easing,
});

export const REMOTION_CODE_APIS = {
  React,
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  random,
  spring,
  useCurrentFrame,
  useVideoConfig,
  mg,
};