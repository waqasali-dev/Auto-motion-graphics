// True generated-film preview and browser MP4 export.
// This player receives LLM-authored Remotion components, never archetype templates.

import { useEffect, useMemo, useRef, useState } from "react";
import { Player, Thumbnail, type PlayerRef } from "@remotion/player";
import { canRenderMediaOnWeb, renderMediaOnWeb } from "@remotion/web-renderer";
import { Download, Film, LoaderCircle, Play, RefreshCw, TriangleAlert } from "lucide-react";
import type { GeneratedFilm } from "../sdk/contract.generated";
import type { GeneratedSceneComponent } from "../services/generatedCode";
import { compileGeneratedShot } from "../services/generatedCode";
import { GeneratedFilmComposition } from "../mg/GeneratedFilm";
import { saveRenderBlob, loadRenderBlob, updateProject } from "../services/projects";
import { AudioTimeline } from "./AudioTimeline";

const FPS = 60;
const W = 1920;
const H = 1080;

export function GeneratedFilmPlayer({
  projectId,
  film,
  audioSrc,
  onProjectUpdate,
  onRegenerateShot,
}: {
  projectId: string;
  film: GeneratedFilm;
  audioSrc?: string;
  onProjectUpdate?: () => void;
  onRegenerateShot?: (shotId: string, validationError?: string) => void;
}) {
  const playerRef = useRef<PlayerRef>(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderUrl, setRenderUrl] = useState<string | null>(null);
  const [inspectCode, setInspectCode] = useState(false);

  const compiled = useMemo(() => {
    try {
      const map: Record<string, GeneratedSceneComponent> = {};
      for (const shot of film.shots) map[shot.shotId] = compileGeneratedShot(shot.sourceCode).component;
      return { scenes: map, error: null as string | null };
    } catch (e) {
      return { scenes: {} as Record<string, GeneratedSceneComponent>, error: (e as Error).message };
    }
  }, [film]);
  const compileError = compiled.error;

  const currentShot = film.shots.find((s) => currentFrame >= s.startFrame && currentFrame < s.endFrame) ?? film.shots[0];
  const inputProps = useMemo(() => ({ film, scenes: compiled.scenes, audioSrc }), [film, compiled.scenes, audioSrc]);

  // Read the Player as the single clock source, including its internally mixed audio.
  useEffect(() => {
    let raf = 0;
    let mounted = true;
    const poll = () => {
      if (!mounted) return;
      const player = playerRef.current;
      if (player) {
        setCurrentFrame((old) => {
          const next = player.getCurrentFrame();
          return old === next ? old : next;
        });
        setPlaying(player.isPlaying());
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => {
      mounted = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    let active = true;
    setRenderUrl(null);
    loadRenderBlob(projectId).then((blob) => {
      if (active && blob) setRenderUrl(URL.createObjectURL(blob));
    });
    return () => {
      active = false;
    };
  }, [projectId, film.createdAt]);

  useEffect(() => () => {
    if (renderUrl) URL.revokeObjectURL(renderUrl);
  }, [renderUrl]);

  const seek = (frame: number) => {
    const safe = Math.max(0, Math.min(film.durationInFrames - 1, Math.floor(frame)));
    playerRef.current?.seekTo(safe);
    setCurrentFrame(safe);
  };

  const exportMp4 = async () => {
    setRendering(true);
    setRenderError(null);
    setRenderProgress(0);
    try {
      const capability = await canRenderMediaOnWeb({ container: "mp4", videoCodec: "h264", width: W, height: H });
      if (!capability.canRender) {
        throw new Error(capability.issues.map((issue) => issue.message).join(" ") || "This browser cannot encode H.264 video with WebCodecs. Use a current Chromium-based browser.");
      }
      const result = await renderMediaOnWeb({
        composition: {
          id: `frame60-${projectId}`,
          component: GeneratedFilmComposition as unknown as React.ComponentType<Record<string, unknown>>,
          durationInFrames: film.durationInFrames,
          fps: FPS,
          width: W,
          height: H,
        },
        inputProps: inputProps as unknown as Record<string, unknown>,
        container: "mp4",
        videoCodec: "h264",
        videoBitrate: "very-high",
        audioCodec: "aac",
        audioBitrate: "high",
        onProgress: ({ progress }) => setRenderProgress(progress),
        pageResponsiveness: "high",
        logLevel: "error",
      });
      const blob = await result.getBlob();
      await saveRenderBlob(projectId, blob);
      const url = URL.createObjectURL(blob);
      setRenderUrl(url);
      updateProject(projectId, { renderedVideoBlobKey: `render:${projectId}` });
      onProjectUpdate?.();
    } catch (e) {
      setRenderError((e as Error).message);
    } finally {
      setRendering(false);
    }
  };

  const download = () => {
    if (!renderUrl) return;
    const a = document.createElement("a");
    a.href = renderUrl;
    a.download = `${film.title.replace(/[^a-z0-9-_]+/gi, "_")}.mp4`;
    a.click();
  };

  const clips = film.shots.map((s) => ({
    shotId: s.shotId,
    startFrame: s.startFrame,
    endFrame: s.endFrame,
    durationFrames: s.durationFrames,
    visualFamily: s.visualFamily,
  }));

  return (
    <div className="space-y-4">
      <div className="bg-[#0b0d12] rounded-2xl border border-zinc-800 p-3 md:p-4">
        {compileError ? (
          <div className="aspect-video flex items-center justify-center p-8 text-center text-red-200">
            <div><TriangleAlert className="w-7 h-7 mx-auto mb-3" /><div className="font-semibold">Generated Remotion code did not compile</div><pre className="mt-2 text-left text-xs whitespace-pre-wrap">{compileError}</pre></div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl ring-1 ring-white/10">
            <Player
              key={film.id}
              ref={playerRef}
              component={GeneratedFilmComposition as unknown as React.ComponentType<Record<string, unknown>>}
              inputProps={inputProps}
              durationInFrames={film.durationInFrames}
              fps={FPS}
              compositionWidth={W}
              compositionHeight={H}
              style={{ width: "100%", aspectRatio: "16 / 9" }}
              controls={false}
              initiallyMuted={false}
              moveToBeginningWhenEnded={false}
              _experimentalKeepAudioContextAlive
              acknowledgeRemotionLicense
            />
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button onClick={() => playerRef.current?.seekTo(Math.max(0, currentFrame - 10))} className="px-3 py-2 rounded-lg bg-[color:var(--color-surface)] text-zinc-900 text-xs font-mono">−10f</button>
          <button onClick={() => playerRef.current?.seekTo(Math.max(0, currentFrame - 1))} className="px-3 py-2 rounded-lg bg-[color:var(--color-surface)] text-zinc-900 text-xs">−1f</button>
          <button onClick={() => playerRef.current?.toggle()} className="w-11 h-11 rounded-lg bg-[color:var(--color-surface)] text-zinc-900 grid place-items-center" aria-label={playing ? "Pause Remotion preview" : "Play Remotion preview"}>
            {playing ? <span className="font-black">Ⅱ</span> : <Play className="w-4 h-4 fill-current" />}
          </button>
          <button onClick={() => playerRef.current?.seekTo(Math.min(film.durationInFrames - 1, currentFrame + 1))} className="px-3 py-2 rounded-lg bg-[color:var(--color-surface)] text-zinc-900 text-xs">+1f</button>
          <button onClick={() => playerRef.current?.seekTo(Math.min(film.durationInFrames - 1, currentFrame + 10))} className="px-3 py-2 rounded-lg bg-[color:var(--color-surface)] text-zinc-900 text-xs font-mono">+10f</button>
          <button onClick={() => playerRef.current?.seekTo(0)} className="px-3 py-2 rounded-lg bg-zinc-800 text-white text-xs">Restart</button>
          <span className="ml-auto font-mono text-xs text-white tabular-nums">{formatTimecode(currentFrame)} / {formatTimecode(film.durationInFrames)}</span>
        </div>
      </div>

      <div className="bg-[color:var(--color-surface)] rounded-xl border border-[color:var(--color-border)] p-4 space-y-3">
        <AudioTimeline
          currentFrame={currentFrame}
          totalFrames={film.durationInFrames}
          durationSec={film.audioDurationSec}
          shots={clips}
          isPlaying={playing}
          onSeek={seek}
          actSpans={buildActSpans(film)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={exportMp4} disabled={rendering || !!compileError} className="px-5 py-3 rounded-xl bg-[#0066ff] hover:bg-[#0052cc] text-white font-semibold flex items-center gap-2 disabled:opacity-50">
            {rendering ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Film className="w-4 h-4" />}
            {rendering ? `Rendering ${Math.round(renderProgress * 100)}%` : "Render MP4 in browser"}
          </button>
          {renderUrl && <button onClick={download} className="px-4 py-3 rounded-xl bg-zinc-900 text-white font-medium flex items-center gap-2"><Download className="w-4 h-4" /> Download MP4</button>}
          {rendering && <span className="text-xs text-[color:var(--color-text-faint)]">60fps · 1920×1080 · original audio · WebCodecs</span>}
        </div>
        {rendering && <div className="h-2 bg-[color:var(--color-surface-3)] rounded-full overflow-hidden"><div className="h-full bg-[#0066ff] transition-all" style={{ width: `${renderProgress * 100}%` }} /></div>}
        {renderError && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">Browser render failed: {renderError}</div>}
        {renderUrl && <video src={renderUrl} controls className="w-full max-h-[360px] bg-black rounded-xl" />}
      </div>

      {currentShot && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-[color:var(--color-surface)] rounded-xl border border-[color:var(--color-border)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div><div className="font-mono text-[10px] uppercase tracking-widest text-[color:var(--color-text-faint)]">AI art direction · {currentShot.shotId}</div><div className="font-semibold mt-1">{currentShot.visualPrompt.visualMetaphor}</div></div>
              {onRegenerateShot && <button onClick={() => onRegenerateShot(currentShot.shotId)} className="px-3 py-2 rounded-lg border border-[color:var(--color-border)] text-xs hover:bg-[color:var(--color-surface-3)] flex items-center gap-1"><RefreshCw className="w-3 h-3" /> Regenerate</button>}
            </div>
            <p className="text-sm leading-relaxed text-[color:var(--color-text-soft)] mt-3">{currentShot.visualPrompt.renderPrompt}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">{currentShot.designChoices.map((x) => <span key={x} className="text-[10px] font-mono px-2 py-1 rounded bg-[color:var(--color-surface-3)]">{x}</span>)}</div>
          </div>
          <div className="bg-[#0b0d12] rounded-xl border border-zinc-800 p-4">
            <div className="flex justify-between items-center text-white">
              <div><div className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">Model-authored Remotion TSX</div><div className="font-semibold mt-1">{currentShot.visualSummary}</div></div>
              <button onClick={() => setInspectCode((x) => !x)} className="px-3 py-2 rounded-lg bg-zinc-800 text-xs">{inspectCode ? "Hide source" : "Inspect source"}</button>
            </div>
            {inspectCode && <pre className="mt-3 max-h-[320px] overflow-auto text-[11px] leading-relaxed text-emerald-200 bg-black/40 rounded-lg p-3 whitespace-pre-wrap">{currentShot.sourceCode}</pre>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Real frame from this project's generated Remotion code, used in the library. */
export function GeneratedFilmPoster({ film, frame = 90 }: { film: GeneratedFilm; frame?: number }) {
  const compiled = useMemo(() => {
    const map: Record<string, GeneratedSceneComponent> = {};
    for (const shot of film.shots) map[shot.shotId] = compileGeneratedShot(shot.sourceCode).component;
    return map;
  }, [film]);
  const inputProps = useMemo(() => ({ film, scenes: compiled }), [film, compiled]);
  return (
    <Thumbnail
      component={GeneratedFilmComposition as unknown as React.ComponentType<Record<string, unknown>>}
      inputProps={inputProps}
      durationInFrames={film.durationInFrames}
      compositionWidth={film.width}
      compositionHeight={film.height}
      fps={film.fps}
      frameToDisplay={Math.max(0, Math.min(film.durationInFrames - 1, frame))}
      style={{ width: "100%", height: "100%" }}
    />
  );
}

function formatTimecode(frame: number) {
  const seconds = Math.floor(frame / 60);
  const frames = frame % 60;
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}

function buildActSpans(film: GeneratedFilm) {
  const spans: Array<{ act: GeneratedFilm["shots"][number]["act"]; label: string; startFrame: number; endFrame: number }> = [];
  for (const shot of film.shots) {
    const last = spans[spans.length - 1];
    if (last?.act === shot.act) last.endFrame = shot.endFrame;
    else spans.push({ act: shot.act, label: shot.act, startFrame: shot.startFrame, endFrame: shot.endFrame });
  }
  return spans;
}