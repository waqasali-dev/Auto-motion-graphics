// src/components/ShotPlayer.tsx
// Plays the edited film: one 1920x1080 comp at 60fps, with planned transitions
// between shots. The timeline marks every cut with its transition type.

import { memo, useCallback, useMemo, useState } from "react";
import { FILM_BEATS } from "../data/film";
import { planVariety } from "../variety/planner";
import { FAMILY_INFO, ACT_INFO } from "../variety/taxonomy";
import { ARCHETYPE_REGISTRY } from "../sdk/registry";
import { FilmStage, ShotStill, TRANSITION_FRAMES } from "../mg/stage";
import { useFrameClock, FPS } from "../sdk/primitives";
import type { PlannedShot, Transition } from "../sdk/contract";
import { Play, Pause, RotateCcw, ChevronLeft, ChevronRight } from "lucide-react";

export const VARIETY_REPORT = planVariety(FILM_BEATS);
export const SHOTS = VARIETY_REPORT.shots;
export const TOTAL_FRAMES = VARIETY_REPORT.totalFrames;

export const TRANSITION_LABEL: Record<Transition, string> = {
  none: "open",
  punch: "punch cut",
  whip: "whip pan",
  zoom: "zoom-through",
  brandWipe: "act wipe",
};

/** A representative still: late enough that the scene has built. */
export const posterFrame = (s: Pick<PlannedShot, "durationFrames">) => Math.min(150, s.durationFrames - 40);

const ShotThumb = memo(function ShotThumb({
  shot,
  active,
  onSelect,
}: {
  shot: PlannedShot;
  active: boolean;
  onSelect: (index: number) => void;
}) {
  const fam = FAMILY_INFO[shot.family];
  return (
    <button
      onClick={() => onSelect(shot.index)}
      aria-pressed={active}
      aria-label={`Seek to ${shot.shotId}, ${shot.archetype}`}
      className={`flex-shrink-0 rounded-lg p-1 border text-left transition-colors ${
        active ? "border-[color:var(--color-electric)] bg-[color:var(--color-electric)]/5" : "border-[color:var(--color-rule)] bg-white hover:border-[color:var(--color-ink)]/30"
      }`}
      style={{ width: 196 }}
    >
      <div className="rounded overflow-hidden pointer-events-none">
        <ShotStill shot={shot} frame={posterFrame(shot)} registry={ARCHETYPE_REGISTRY} />
      </div>
      <div className="flex items-center gap-1.5 px-1 pt-1.5">
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: fam.color }} />
        <span className="text-[11px] font-semibold text-[color:var(--color-ink)] truncate">{shot.archetype}</span>
      </div>
      <div className="flex justify-between font-mono text-[9px] text-[color:var(--color-ink-soft)] px-1 pb-0.5">
        <span className="truncate">{TRANSITION_LABEL[shot.transitionIn]}</span>
        <span>{(shot.durationFrames / FPS).toFixed(1)}s</span>
      </div>
    </button>
  );
});

export function ShotPlayer() {
  const [playing, setPlaying] = useState(true);
  const { frame, setFrame } = useFrameClock(playing);

  const g = ((frame % TOTAL_FRAMES) + TOTAL_FRAMES) % TOTAL_FRAMES;
  const current = useMemo<PlannedShot>(() => SHOTS.find((s) => g >= s.startFrame && g < s.endFrame) ?? SHOTS[0], [g]);
  const fam = FAMILY_INFO[current.family];
  const act = ACT_INFO[current.act];

  const seekToShot = useCallback(
    (idx: number) => {
      setFrame(SHOTS[idx].startFrame + Math.ceil(TRANSITION_FRAMES[SHOTS[idx].transitionIn] / 2) + 1);
      setPlaying(true);
    },
    [setFrame],
  );
  const step = (delta: number) => {
    setPlaying(false);
    setFrame(g + delta);
  };
  const tc = (fr: number) => `${String(Math.floor(fr / FPS / 60)).padStart(2, "0")}:${String(Math.floor(fr / FPS) % 60).padStart(2, "0")}:${String(fr % FPS).padStart(2, "0")}`;

  return (
    <div className="bg-[#0B0D12] rounded-3xl overflow-hidden shadow-[0_40px_100px_-40px_rgba(17,24,39,0.6)] border border-black">
      {/* Program monitor */}
      <div className="p-3 md:p-4">
        <div className="rounded-lg overflow-hidden ring-1 ring-white/10">
          <FilmStage shots={SHOTS} frame={g} registry={ARCHETYPE_REGISTRY} />
        </div>
      </div>

      <div className="bg-[#F4F6F9] px-5 md:px-7 py-5 space-y-4">
        {/* Transport */}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => step(-10)} className="px-2.5 py-2 rounded-lg bg-white border border-[color:var(--color-rule)] hover:bg-slate-100 text-xs font-mono">
            −10f
          </button>
          <button onClick={() => step(-1)} className="p-2 rounded-lg bg-white border border-[color:var(--color-rule)] hover:bg-slate-100" aria-label="Previous frame">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setPlaying((p) => !p)}
            className="w-12 h-12 rounded-xl bg-[color:var(--color-ink)] text-white flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
          </button>
          <button onClick={() => step(1)} className="p-2 rounded-lg bg-white border border-[color:var(--color-rule)] hover:bg-slate-100" aria-label="Next frame">
            <ChevronRight className="w-4 h-4" />
          </button>
          <button onClick={() => step(10)} className="px-2.5 py-2 rounded-lg bg-white border border-[color:var(--color-rule)] hover:bg-slate-100 text-xs font-mono">
            +10f
          </button>
          <button onClick={() => setFrame(0)} className="p-2 rounded-lg bg-white border border-[color:var(--color-rule)] hover:bg-slate-100 text-[color:var(--color-ink-soft)]" aria-label="Restart">
            <RotateCcw className="w-4 h-4" />
          </button>
          <div className="flex flex-wrap items-center gap-2 ml-2 font-mono text-[10px] uppercase tracking-[0.16em]">
            <span className="px-2 py-1 rounded bg-[color:var(--color-ink)] text-white">{current.shotId}</span>
            <span className="px-2 py-1 rounded text-white" style={{ background: fam.color }}>
              {fam.label}
            </span>
            <span className="text-[color:var(--color-ink)]">{current.archetype}</span>
            <span className="text-[color:var(--color-ink-soft)]">· Act {act.roman} {act.label}</span>
          </div>
          <div className="ml-auto font-mono text-sm tabular-nums text-[color:var(--color-ink)]">
            {tc(g)} <span className="text-[color:var(--color-ink-soft)]">/ {tc(TOTAL_FRAMES)}</span>
          </div>
        </div>

        {/* Timeline: clips coloured by family, cut markers by transition */}
        <div className="relative">
          <div className="relative h-12 rounded-md bg-white border border-[color:var(--color-rule)] overflow-hidden flex">
            {SHOTS.map((s) => (
              <div
                key={s.shotId}
                className="h-full relative border-r-2 border-white last:border-r-0 flex items-end"
                style={{
                  width: `${(s.durationFrames / TOTAL_FRAMES) * 100}%`,
                  background: s.index === current.index ? FAMILY_INFO[s.family].color : `${FAMILY_INFO[s.family].color}66`,
                }}
              >
                <span className="font-mono text-[9px] text-white px-1 pb-0.5 truncate">{s.archetype}</span>
              </div>
            ))}
            {SHOTS.slice(1).map((s) => (
              <div
                key={`t-${s.shotId}`}
                className="absolute top-0 h-2 bg-[color:var(--color-ink)]/70 pointer-events-none"
                style={{
                  left: `${((s.startFrame - TRANSITION_FRAMES[s.transitionIn] / 2) / TOTAL_FRAMES) * 100}%`,
                  width: `${(TRANSITION_FRAMES[s.transitionIn] / TOTAL_FRAMES) * 100}%`,
                  minWidth: 3,
                }}
                title={TRANSITION_LABEL[s.transitionIn]}
              />
            ))}
            <div className="absolute top-0 bottom-0 w-[2px] bg-[color:var(--color-coral)] pointer-events-none" style={{ left: `${(g / TOTAL_FRAMES) * 100}%` }} />
            <input
              type="range"
              min={0}
              max={TOTAL_FRAMES - 1}
              value={g}
              onChange={(e) => {
                setPlaying(false);
                setFrame(parseInt(e.target.value, 10));
              }}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              aria-label="Timeline scrub"
            />
          </div>
          <div className="relative h-5 mt-1">
            {SHOTS[0].meta.spans.map((span) => (
              <div
                key={span.act}
                className="absolute top-0 font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--color-ink-soft)] truncate pl-1 border-l border-[color:var(--color-ink)]/20"
                style={{
                  left: `${(span.startFrame / TOTAL_FRAMES) * 100}%`,
                  width: `${((span.endFrame - span.startFrame) / TOTAL_FRAMES) * 100}%`,
                }}
              >
                {ACT_INFO[span.act].roman} · {span.label}
              </div>
            ))}
          </div>
        </div>

        {/* Why this shot */}
        <div className="flex flex-wrap gap-1.5">
          {current.reasons.map((r) => (
            <span key={r} className="px-2 py-1 rounded bg-white border border-[color:var(--color-rule)] text-[11px] font-mono text-[color:var(--color-ink-soft)]">
              {r}
            </span>
          ))}
        </div>

        {/* Contact sheet */}
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
          {SHOTS.map((s) => (
            <ShotThumb key={s.shotId} shot={s} active={s.index === current.index} onSelect={seekToShot} />
          ))}
        </div>
      </div>
    </div>
  );
}
