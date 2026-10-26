// src/mg/stage.tsx
// The edit. Plays planned shots on one timeline. Around each cut both shots are
// rendered and a transition carries the eye from one to the other, the way an
// editor would cut it, instead of each shot fading itself in and out.

import type { ComponentType, CSSProperties, ReactNode } from "react";
import type { PlannedShot, SceneProps, Transition, ArchetypeName } from "../sdk/contract";
import { ACT_INFO } from "../variety/taxonomy";
import { Composition, FilmFinish, E, kf, mb, W, H, SERIF, COLOR, Rise } from "./core";

export const TRANSITION_FRAMES: Record<Transition, number> = {
  none: 0,
  punch: 8,
  whip: 20,
  zoom: 24,
  brandWipe: 44,
};

interface Layer {
  shot: PlannedShot;
  local: number;
  style: CSSProperties;
}

interface Resolved {
  layers: Layer[];
  overlay?: { type: Transition; p: number; to: PlannedShot };
}

function blend(a: PlannedShot, b: PlannedShot, g: number, p: number): Resolved {
  const type = b.transitionIn;
  const T = TRANSITION_FRAMES[type];
  const dp = 1 / T;
  const la = g - a.startFrame;
  const lb = g - b.startFrame;
  const dir = b.transitionDir;

  switch (type) {
    case "whip": {
      const xo = (q: number) => -dir * kf(q, [[0, 0], [0.5, W * 0.9, E.in]]);
      const xi = (q: number) => dir * kf(q, [[0.5, W * 0.9], [1, 0, E.out]]);
      if (p < 0.5) {
        return { layers: [{ shot: a, local: la, style: { transform: `translateX(${xo(p)}px)`, filter: mb(xo(p) - xo(p - dp)) } }] };
      }
      return { layers: [{ shot: b, local: lb, style: { transform: `translateX(${xi(p)}px)`, filter: mb(xi(p) - xi(p - dp)) } }] };
    }
    case "zoom": {
      const so = kf(p, [[0, 1], [0.55, 2.2, E.in]]);
      const oo = kf(p, [[0.3, 1], [0.55, 0]]);
      const si = kf(p, [[0.35, 0.72], [1, 1, E.out]]);
      const oi = kf(p, [[0.35, 0], [0.55, 1]]);
      return {
        layers: [
          { shot: b, local: lb, style: { transform: `scale(${si})`, opacity: oi } },
          { shot: a, local: la, style: { transform: `scale(${so})`, opacity: oo, filter: `blur(${(so - 1) * 10}px)` } },
        ],
      };
    }
    case "punch": {
      if (p < 0.5) return { layers: [{ shot: a, local: la, style: {} }] };
      return {
        layers: [{ shot: b, local: lb, style: { transform: `scale(${kf(p, [[0.5, 1.08], [1, 1, E.out]])})` } }],
        overlay: { type, p, to: b },
      };
    }
    case "brandWipe":
      return { layers: [{ shot: p < 0.5 ? a : b, local: p < 0.5 ? la : lb, style: {} }], overlay: { type, p, to: b } };
    default:
      return { layers: [{ shot: b, local: lb, style: {} }] };
  }
}

export function resolveFrame(shots: PlannedShot[], g: number): Resolved {
  let idx = shots.findIndex((s) => g >= s.startFrame && g < s.endFrame);
  if (idx < 0) idx = g < 0 ? 0 : shots.length - 1;
  const cur = shots[idx];

  const tIn = TRANSITION_FRAMES[cur.transitionIn];
  if (idx > 0 && tIn > 0 && g - cur.startFrame < tIn / 2) {
    return blend(shots[idx - 1], cur, g, (g - (cur.startFrame - tIn / 2)) / tIn);
  }
  const next = shots[idx + 1];
  if (next) {
    const tN = TRANSITION_FRAMES[next.transitionIn];
    if (tN > 0 && next.startFrame - g <= tN / 2) {
      return blend(cur, next, g, (g - (next.startFrame - tN / 2)) / tN);
    }
  }
  return { layers: [{ shot: cur, local: g - cur.startFrame, style: {} }] };
}

/** Act chapter card carried by a two-panel branded wipe. */
function BrandWipe({ p, to }: { p: number; to: PlannedShot }) {
  const T = TRANSITION_FRAMES.brandWipe;
  const lf = p * T;
  const panelX = (q: number) =>
    q < 0.5 ? kf(q, [[0, W + 300], [0.4, 0, E.inOut]]) : kf(q, [[0.6, 0], [1, -W - 300, E.inOut]]);
  const x1 = panelX(p);
  const x2 = panelX(Math.max(0, p - 0.06));
  const act = ACT_INFO[to.act];
  const panel = (x: number, color: string, z: number, children?: ReactNode) => (
    <div
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: x - 300,
        width: W + 600,
        background: color,
        clipPath: "polygon(14% 0, 100% 0, 86% 100%, 0 100%)",
        zIndex: z,
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
  return (
    <>
      {panel(x2, COLOR.ink, 60)}
      {panel(
        x1,
        COLOR.blue,
        61,
      <div
        style={{
          position: "absolute",
          top: 0,
          height: H,
          left: 300 - x1,
          width: W,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 60,
          color: "#fff",
        }}
      >
        <Rise f={lf} at={T * 0.22} h={360} out={T * 0.6}>
          <span style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 360, lineHeight: 0.9 }}>{act.roman}</span>
        </Rise>
        <div>
          <Rise f={lf} at={T * 0.28} h={30} out={T * 0.6}>
            <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: "0.3em", textTransform: "uppercase", opacity: 0.8 }}>Act {act.roman}</span>
          </Rise>
          <div style={{ height: 10 }} />
          <Rise f={lf} at={T * 0.32} h={130} out={T * 0.62}>
            <span style={{ fontSize: 130, fontWeight: 800, letterSpacing: "-0.05em" }}>{act.label}</span>
          </Rise>
        </div>
      </div>,
      )}
    </>
  );
}

function Bug({ shot }: { shot: PlannedShot }) {
  const act = ACT_INFO[shot.act];
  const common: CSSProperties = {
    position: "absolute",
    top: 46,
    zIndex: 80,
    color: "#fff",
    mixBlendMode: "difference",
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: "0.22em",
    textTransform: "uppercase",
    opacity: 0.75,
  };
  return (
    <>
      <div style={{ ...common, left: 60, display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ width: 16, height: 16, background: "#fff" }} />
        frame/60
      </div>
      <div style={{ ...common, right: 60 }}>
        {act.roman} · {act.label}
      </div>
    </>
  );
}

export type SceneRegistry = Record<ArchetypeName, ComponentType<SceneProps>>;

function renderLayer(l: Layer, registry: SceneRegistry) {
  const Scene = registry[l.shot.archetype];
  return (
    <div key={l.shot.shotId} style={{ position: "absolute", inset: 0, overflow: "hidden", ...l.style }}>
      <Scene frame={l.local} duration={l.shot.durationFrames} mode={l.shot.mode} content={l.shot.content} energy={l.shot.energy} />
    </div>
  );
}

/** The master film: every shot, every transition, one comp. */
export function FilmStage({ shots, frame, registry }: { shots: PlannedShot[]; frame: number; registry: SceneRegistry }) {
  const { layers, overlay } = resolveFrame(shots, frame);
  const current = layers[layers.length - 1].shot;
  return (
    <Composition>
      {layers.map((l) => renderLayer(l, registry))}
      {overlay?.type === "brandWipe" && <BrandWipe p={overlay.p} to={overlay.to} />}
      {overlay?.type === "punch" && (
        <div style={{ position: "absolute", inset: 0, zIndex: 60, background: "#fff", opacity: kf(overlay.p, [[0.5, 0.85], [0.8, 0]]) }} />
      )}
      <Bug shot={current} />
      <FilmFinish f={frame} />
    </Composition>
  );
}

/** A single still of one shot, for contact sheets and galleries. */
export function ShotStill({
  shot,
  frame,
  registry,
}: {
  shot: Pick<PlannedShot, "archetype" | "durationFrames" | "mode" | "content" | "energy">;
  frame: number;
  registry: SceneRegistry;
}) {
  const Scene = registry[shot.archetype];
  return (
    <Composition>
      <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
        <Scene frame={frame} duration={shot.durationFrames} mode={shot.mode} content={shot.content} energy={shot.energy} />
      </div>
      <FilmFinish f={frame} />
    </Composition>
  );
}

