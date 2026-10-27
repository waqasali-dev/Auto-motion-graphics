// The AI-authored film composition. The model generates every scene component;
// this file only supplies the shared 60fps timeline, audio track, edit grammar,
// and film finish.

import type { ComponentType } from "react";
import { Audio } from "@remotion/media";
import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { GeneratedFilm, GeneratedSceneShot } from "../sdk/contract.generated";
import { ACT_INFO } from "../variety/taxonomy";
import { FilmFinish } from "./core";
import type { GeneratedSceneProps } from "../services/generatedCode";

type GeneratedMap = Record<string, ComponentType<GeneratedSceneProps>>;

const CUT_FRAMES: Record<string, number> = { none: 0, punch: 8, whip: 20, zoom: 24, brandWipe: 44 };

function EditTransition({ shot, duration }: { shot: GeneratedSceneShot; duration: number }) {
  const f = useCurrentFrame();
  const p = interpolate(f, [0, Math.max(1, duration - 1)], [0, 1], {
    easing: Easing.bezier(0.83, 0, 0.17, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const dir = shot.transitionDirection;
  const act = ACT_INFO[shot.act];

  if (shot.transitionIn === "none") return null;
  if (shot.transitionIn === "punch") {
    const flash = interpolate(f, [0, duration * 0.25, duration * 0.7, duration], [0, 0.92, 0.15, 0], {
      extrapolateLeft: "clamp", extrapolateRight: "clamp",
    });
    return <AbsoluteFill style={{ backgroundColor: "#fff", opacity: flash, zIndex: 40 }} />;
  }
  if (shot.transitionIn === "whip") {
    const x = interpolate(p, [0, 0.48, 1], [dir * 2100, 0, -dir * 2100]);
    return (
      <AbsoluteFill style={{ overflow: "hidden", zIndex: 40, pointerEvents: "none" }}>
        <div style={{ position: "absolute", top: -200, bottom: -200, left: "50%", width: 560, transform: `translateX(${x}px) skewX(${-dir * 19}deg)`, background: "linear-gradient(90deg,transparent,rgba(255,255,255,.86),rgba(0,102,255,.34),transparent)", filter: "blur(34px)" }} />
      </AbsoluteFill>
    );
  }
  if (shot.transitionIn === "zoom") {
    const scale = interpolate(p, [0, 1], [0.2, 2.6]);
    const opacity = interpolate(p, [0, 0.15, 0.68, 1], [0, 0.82, 0.42, 0]);
    return (
      <AbsoluteFill style={{ zIndex: 40, alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
        <div style={{ width: 260, height: 260, border: "18px solid rgba(255,255,255,.88)", borderRadius: "50%", boxShadow: "0 0 80px rgba(0,102,255,.85), inset 0 0 70px rgba(0,102,255,.6)", transform: `scale(${scale})`, opacity }} />
      </AbsoluteFill>
    );
  }

  const x = interpolate(p, [0, 0.43, 0.62, 1], [dir * 2100, 0, 0, -dir * 2100]);
  return (
    <AbsoluteFill style={{ overflow: "hidden", zIndex: 45, pointerEvents: "none" }}>
      <div style={{ position: "absolute", inset: 0, background: "#080b13", clipPath: `inset(0 ${p < 0.5 ? 100 - p * 200 : (p - 0.5) * 200}% 0 ${p < 0.5 ? p * 200 : 100 - (p - 0.5) * 200}%)`, opacity: 0.88 }} />
      <div style={{ position: "absolute", inset: 0, backgroundColor: "#0066ff", clipPath: "polygon(13% 0,100% 0,87% 100%,0 100%)", transform: `translateX(${x}px)` }} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 54, color: "#fff", opacity: interpolate(p, [0.18, 0.33, 0.68, 0.88], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), transform: `translateX(${x}px)` }}>
        <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic", fontSize: 300, lineHeight: 0.9 }}>{act.roman}</div>
        <div>
          <div style={{ fontSize: 24, letterSpacing: "0.3em", textTransform: "uppercase", opacity: 0.72 }}>Act {act.roman}</div>
          <div style={{ fontSize: 118, fontWeight: 800, letterSpacing: "-0.05em" }}>{act.label}</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function FilmBug({ film }: { film: GeneratedFilm }) {
  const f = useCurrentFrame();
  const opacity = interpolate(f, [0, 18], [0, 0.72], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <>
      <div style={{ position: "absolute", top: 38, left: 52, zIndex: 80, color: "#fff", mixBlendMode: "difference", opacity, fontSize: 19, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase" }}>◼ {film.title}</div>
      <div style={{ position: "absolute", top: 38, right: 52, zIndex: 80, color: "#fff", mixBlendMode: "difference", opacity, fontFamily: "'JetBrains Mono', monospace", fontSize: 16, letterSpacing: "0.18em" }}>FRAME / 60</div>
    </>
  );
}

export interface GeneratedFilmInputProps {
  film: GeneratedFilm;
  scenes: GeneratedMap;
  audioSrc?: string;
}

export function GeneratedFilmComposition({ film, scenes, audioSrc }: GeneratedFilmInputProps) {
  const config = useVideoConfig();
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: "#070a12", overflow: "hidden" }}>
      {film.shots.map((shot) => {
        const Scene = scenes[shot.shotId];
        if (!Scene) return null;
        return (
          <Sequence key={shot.shotId} from={shot.startFrame} durationInFrames={shot.durationFrames} name={shot.shotId}>
            <Scene
              shotPlan={shot}
              visualPrompt={shot.visualPrompt!}
              wordCues={shot.wordCues}
              continuity={shot.continuity}
              assets={[]}
            />
          </Sequence>
        );
      })}
      {film.shots.slice(1).map((shot) => {
        const transitionFrames = CUT_FRAMES[shot.transitionIn] ?? 0;
        if (!transitionFrames) return null;
        const from = Math.max(0, shot.startFrame - Math.floor(transitionFrames / 2));
        return (
          <Sequence key={`cut-${shot.shotId}`} from={from} durationInFrames={transitionFrames} name={`cut-${shot.shotId}`}>
            <EditTransition shot={shot} duration={transitionFrames} />
          </Sequence>
        );
      })}
      {audioSrc ? <Audio src={audioSrc} volume={1} /> : null}
      <FilmBug film={film} />
      <FilmFinish f={config.durationInFrames > 0 ? frame : 0} grain={0.035} vignette={0.28} />
    </AbsoluteFill>
  );
}