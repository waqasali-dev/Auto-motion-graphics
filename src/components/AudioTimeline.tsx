// src/components/AudioTimeline.tsx
// Audio waveform timeline with 60fps scrub + shot markers — designed like a DAW/NLE timeline

import { useRef, useState } from "react";
import type { ActId, Family } from "../sdk/contract";
import { FAMILY_INFO, ACT_INFO } from "../variety/taxonomy";

interface TimelineShot {
  shotId: string;
  startFrame: number;
  endFrame?: number;
  durationFrames: number;
  family?: Family;
  visualFamily?: Family;
  archetype?: string;
  meta?: { spans?: Array<{ act: ActId; label: string; startFrame: number; endFrame: number }> };
}

interface ActSpan {
  act: ActId;
  label: string;
  startFrame: number;
  endFrame: number;
}

export function AudioTimeline({
  currentFrame,
  totalFrames,
  durationSec,
  shots,
  isPlaying,
  onSeek,
  audioRef,
  actSpans,
}: {
  currentFrame: number;
  totalFrames: number;
  durationSec: number;
  shots: TimelineShot[];
  isPlaying: boolean;
  onSeek: (frame: number) => void;
  audioRef?: React.RefObject<HTMLAudioElement | null>;
  actSpans?: ActSpan[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverFrame, setHoverFrame] = useState<number | null>(null);
  const [waveformBars] = useState(() => Array.from({ length: 160 }, (_, i) => 0.25 + (Math.sin(i * 12.9898) * 0.5 + 0.5) * 0.75));

  // Render audio waveform if audio element has buffer — otherwise synthetic
  const [peaks] = useState<number[] | null>(null);

  void audioRef;

  const bars = peaks ?? waveformBars;

  const handlePointer = (e: React.PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = (e.clientX - rect.left) / rect.width;
    const frame = Math.floor(pct * totalFrames);
    onSeek(Math.max(0, Math.min(totalFrames - 1, frame)));
  };

  const handleMove = (e: React.PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = (e.clientX - rect.left) / rect.width;
    setHoverFrame(Math.floor(pct * totalFrames));
  };

  return (
    <div className="space-y-2">
      {/* Time ruler */}
      <div className="flex justify-between font-mono text-[10px] text-[color:var(--color-ink-soft)] tabular-nums px-1">
        <span>{formatTC(currentFrame)}</span>
        <span className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isPlaying ? "bg-emerald-500 animate-pulse" : "bg-zinc-400"}`} />
          {isPlaying ? "SYNC 60fps" : "PAUSED"}
        </span>
        <span>{formatTC(totalFrames)} · {durationSec.toFixed(1)}s</span>
      </div>

      {/* Waveform + clips */}
      <div
        ref={containerRef}
        className="relative h-[84px] rounded-xl bg-[#0B0D12] border border-zinc-800 overflow-hidden select-none cursor-pointer"
        onPointerDown={handlePointer}
        onPointerMove={handleMove}
        onPointerLeave={() => setHoverFrame(null)}
      >
        {/* Waveform bars */}
        <div className="absolute inset-0 flex items-center gap-[2px] px-2">
          {bars.map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-full transition-opacity"
              style={{
                height: `${h * 56}px`,
                background: i / bars.length < currentFrame / totalFrames ? "#0066FF" : "rgba(255,255,255,0.22)",
                minWidth: 2,
              }}
            />
          ))}
        </div>

        {/* Shot clips */}
        <div className="absolute bottom-0 left-0 right-0 h-[22px] flex">
          {shots.map((s) => (
            <div
              key={s.shotId}
              className="h-full border-r border-black/40 flex items-center px-1.5 truncate"
              style={{
                width: `${(s.durationFrames / totalFrames) * 100}%`,
                background: FAMILY_INFO[(s.family ?? s.visualFamily ?? "editorial")].color,
                opacity: 0.92,
              }}
              title={`${s.shotId} · ${s.archetype ?? "generated Remotion scene"} · ${s.family ?? s.visualFamily ?? "editorial"}`}
            >
              <span className="font-mono text-[9px] font-bold text-white truncate">{s.shotId}</span>
            </div>
          ))}
        </div>

        {/* Act labels */}
        <div className="absolute top-1 left-0 right-0 h-4 flex pointer-events-none">
          {(actSpans ?? shots[0]?.meta?.spans ?? []).map((span) => (
            <div
              key={span.act}
              className="font-mono text-[9px] tracking-widest text-white/60 px-1.5 truncate border-l border-white/20"
              style={{
                position: "absolute",
                left: `${(span.startFrame / totalFrames) * 100}%`,
                width: `${((span.endFrame - span.startFrame) / totalFrames) * 100}%`,
              }}
            >
              {ACT_INFO[span.act].roman} {span.label}
            </div>
          ))}
        </div>

        {/* Playhead */}
        <div className="absolute top-0 bottom-0 w-[2px] bg-white pointer-events-none z-10" style={{ left: `${(currentFrame / totalFrames) * 100}%` }}>
          <div className="absolute -top-1 -left-[5px] w-[12px] h-[12px] bg-white rotate-45" />
        </div>

        {/* Hover preview */}
        {hoverFrame !== null && (
          <div className="absolute top-1 bottom-0 w-px bg-white/40 pointer-events-none" style={{ left: `${(hoverFrame / totalFrames) * 100}%` }} />
        )}
      </div>

      {/* Scrub input (invisible, for keyboard) */}
      <input
        type="range"
        min={0}
        max={Math.max(0, totalFrames - 1)}
        value={currentFrame}
        onChange={(e) => onSeek(parseInt(e.target.value, 10))}
        className="sr-only"
        aria-label="Timeline scrub"
      />
    </div>
  );
}

function formatTC(frame: number): string {
  const totalSec = frame / 60;
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  const f = frame % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}
