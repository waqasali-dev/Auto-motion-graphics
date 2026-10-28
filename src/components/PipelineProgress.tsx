// src/components/PipelineProgress.tsx
// Minimal by default, deep on demand: each stage shows one clear heading and a
// one-line status. Expanding a stage reveals the model's actual working —
// storyboard beats, art-direction prompts, generated TSX and validation traces.

import { useEffect, useMemo, useRef, useState } from "react";
import type { PipelineLog, Project } from "../services/projects";
import type { GeneratedFilm } from "../sdk/contract.generated";
import { Check, ChevronRight, CircleDashed, LoaderCircle, TriangleAlert, Play, RotateCcw } from "lucide-react";

export type StageKey = "1_preprocessor" | "2_planner" | "3_art-direction" | "4_codegen" | "5_validator";

export interface StageProgress {
  stage: "planning" | "art-direction" | "coding" | "validation";
  completed: number;
  total: number;
  message: string;
}

const STAGES: Array<{ key: StageKey; title: string; blurb: string; maps?: StageProgress["stage"] }> = [
  { key: "1_preprocessor", title: "Read transcript & lock word timing", blurb: "Every word gets an exact frame from your audio." },
  { key: "2_planner", title: "Plan what each spoken beat shows", blurb: "A creative director storyboards the film.", maps: "planning" },
  { key: "3_art-direction", title: "Write the visual prompt per shot", blurb: "Precise composition, camera and word choreography.", maps: "art-direction" },
  { key: "4_codegen", title: "Generate Remotion code", blurb: "A worker writes original TSX for each shot.", maps: "coding" },
  { key: "5_validator", title: "Compile & smoke-render", blurb: "Each scene is compiled and rendered before preview.", maps: "validation" },
];

type Status = "pending" | "active" | "done" | "error";

function elapsedLabel(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function PipelineProgress({
  logs,
  stageProgress,
  running,
  startedAt,
  hasDraft = false,
  draftFilm,
  project,
  onContinue,
  onStartFromStage,
}: {
  logs: PipelineLog[];
  stageProgress: StageProgress | null;
  running: boolean;
  startedAt: number | null;
  hasDraft?: boolean;
  draftFilm?: GeneratedFilm | null;
  project?: Project | null;
  onContinue?: () => void;
  onStartFromStage?: (stage: "audio-align" | "planning" | "art-direction" | "coding" | "validation") => void;
}) {
  const [expanded, setExpanded] = useState<Set<StageKey>>(new Set());
  const [now, setNow] = useState(() => Date.now());

  const targetFilm = draftFilm || project?.pipelineDraft || project?.generatedFilm;
  const totalShots = targetFilm?.shots?.length || 0;
  const promptedShots = targetFilm?.shots?.filter((s) => s.visualPrompt?.elements?.length)?.length || 0;
  const codedShots = targetFilm?.shots?.filter((s) => s.sourceCode && s.sourceCode.length > 50)?.length || 0;
  const passedShots = targetFilm?.shots?.filter((s) => s.codeStatus === "smoke-passed")?.length || 0;
  const hasWords = Boolean(targetFilm?.wordCues?.length || project?.rawTranscript?.words?.length || project?.transcriptText);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [running]);

  const byStage = useMemo(() => {
    const map = new Map<StageKey, PipelineLog[]>();
    for (const stage of STAGES) map.set(stage.key, []);
    for (const log of logs) {
      const key = STAGES.find((s) => s.key === log.stage)?.key;
      if (key) map.get(key)!.push(log);
      else if (log.stage === "1_audio-align") map.get("1_preprocessor")!.push(log);
      else if (log.stage === "error") {
        let targetKey: StageKey = "5_validator";
        for (const stage of STAGES) {
          const entries = map.get(stage.key) || [];
          if (entries.length > 0 && !entries.some((e) => e.status === "success")) {
            targetKey = stage.key;
            break;
          }
        }
        map.get(targetKey)!.push(log);
      }
    }
    return map;
  }, [logs]);

  const statusOf = (key: StageKey): Status => {
    const entries = byStage.get(key) ?? [];
    if (running && stageProgress && STAGES.find((s) => s.key === key)?.maps === stageProgress.stage) return "active";
    if (entries.some((e) => e.status === "error")) return "error";
    if (entries.some((e) => e.status === "success")) return "done";

    // Deduce from real draft data
    if (key === "1_preprocessor") {
      if (hasWords && (totalShots > 0 || project?.rawTranscript?.words?.length)) return "done";
      return running ? "active" : "pending";
    }

    if (key === "2_planner") {
      if (totalShots > 0) return "done";
      return running ? "active" : "pending";
    }

    if (key === "3_art-direction") {
      if (totalShots > 0 && promptedShots >= totalShots) return "done";
      if (promptedShots > 0) return running ? "active" : "done";
      return running ? "active" : "pending";
    }

    if (key === "4_codegen") {
      if (totalShots > 0 && codedShots >= totalShots) return "done";
      if (codedShots > 0) return running ? "active" : "pending";
      return running ? "active" : "pending";
    }

    if (key === "5_validator") {
      if (project?.generatedFilm || (totalShots > 0 && passedShots >= totalShots)) return "done";
      return running ? "active" : "pending";
    }

    if (entries.length) return running ? "active" : "done";
    return "pending";
  };

  const messageOf = (stage: (typeof STAGES)[0], status: Status): string => {
    const entries = byStage.get(stage.key) ?? [];
    const latest = [...entries].reverse().find((e) => e.message);
    const live = stageProgress && stage.maps === stageProgress.stage && status === "active" ? stageProgress : null;
    if (live) return live.message;
    if (latest?.message) return latest.message;

    if (stage.key === "1_preprocessor") {
      const words = targetFilm?.wordCues?.length || project?.rawTranscript?.words?.length;
      if (status === "done") return `✓ Completed: ${words ? `${words} spoken words` : "Speech"} aligned to frame clock (${Math.round(targetFilm?.audioDurationSec || project?.audioDurationSec || 0)}s).`;
      return stage.blurb;
    }

    if (stage.key === "2_planner") {
      if (status === "done") return `✓ Completed: Storyboarded into ${totalShots} visual shots with frame-locked timing.`;
      return stage.blurb;
    }

    if (stage.key === "3_art-direction") {
      if (status === "done") return `✓ Completed: All ${totalShots} shots authored with visual layout and SVG metaphors.`;
      if (promptedShots > 0) return `${promptedShots}/${totalShots} shots authored with visual direction.`;
      return stage.blurb;
    }

    if (stage.key === "4_codegen") {
      if (status === "done") return `✓ Completed: All ${totalShots} Remotion scene components generated.`;
      if (codedShots > 0) return `In progress: ${codedShots}/${totalShots} scenes coded. Ready to continue.`;
      if (totalShots > 0) return `⏳ Pending: Ready to code ${totalShots} Remotion scenes in parallel. Click Continue.`;
      return stage.blurb;
    }

    if (stage.key === "5_validator") {
      if (status === "done") return `✓ Completed: All ${totalShots} scenes compiled and smoke tested.`;
      return stage.blurb;
    }

    return stage.blurb;
  };

  const activeIndex = STAGES.findIndex((s) => statusOf(s.key) === "active");
  const doneCount = STAGES.filter((s) => statusOf(s.key) === "done").length;
  const overall = Math.round((doneCount / STAGES.length) * 100);
  const hasError = !running && STAGES.some((s) => statusOf(s.key) === "error");

  const toggle = (key: StageKey) =>
    setExpanded((old) => {
      const next = new Set(old);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (!logs.length && !running && !hasDraft && !targetFilm && !project?.transcriptText) return null;

  return (
    <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] overflow-hidden shadow-sm">
      <header className="px-4 py-3.5 border-b border-[color:var(--color-border)] flex items-center gap-3 bg-[color:var(--color-surface-2)]/50">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[color:var(--color-text)] flex items-center gap-2">
            <span>{running ? "Building your film" : hasError ? "Generation stopped" : doneCount === STAGES.length ? "Film ready" : doneCount > 0 ? "Saved Film Progress" : "Pipeline Phases"}</span>
            {!running && doneCount > 0 && doneCount < STAGES.length && (
              <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 font-mono text-[10px] font-bold">
                {doneCount}/{STAGES.length} Done
              </span>
            )}
          </h3>
          <p className="text-[11px] text-[color:var(--color-text-faint)] truncate mt-0.5">
            {running
              ? stageProgress?.message || "Working…"
              : hasError
                ? "Expand the failed stage to read the exact error or click Continue."
                : doneCount === STAGES.length
                  ? `${STAGES.length} stages complete`
                  : doneCount > 0
                    ? `${doneCount} of ${STAGES.length} stages completed · Phase ${doneCount + 1} ready to continue`
                    : "5 pipeline phases ready — word timing, storyboard planning, art direction, code generation, and smoke test"}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {(hasError || (hasDraft && doneCount < STAGES.length)) && onContinue && !running && (
            <button
              onClick={onContinue}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center gap-1.5 shadow-sm shadow-emerald-500/20 transition-all cursor-pointer"
              title="Continue generation from where it was left off"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Continue Generation
            </button>
          )}
          {startedAt && <span className="font-mono text-[11px] text-[color:var(--color-text-faint)] tabular-nums">{elapsedLabel((running ? now : logs.at(-1)?.timestamp ?? now) - startedAt)}</span>}
          <span className="font-mono text-[11px] text-[color:var(--color-text-soft)] tabular-nums font-bold">{overall}%</span>
        </div>
      </header>

      <div className="h-1 bg-[color:var(--color-surface-3)]">
        <div
          className={`h-full transition-all duration-500 ${hasError ? "bg-red-500" : doneCount === STAGES.length ? "bg-emerald-500" : "bg-blue-500"}`}
          style={{ width: `${hasError ? 100 : overall}%` }}
        />
      </div>

      <ol className="divide-y divide-[color:var(--color-border)]">
        {STAGES.map((stage, index) => {
          const status = statusOf(stage.key);
          const entries = byStage.get(stage.key) ?? [];
          const isOpen = expanded.has(stage.key);
          const live = stageProgress && stage.maps === stageProgress.stage && status === "active" ? stageProgress : null;
          const detailCount = entries.filter((e) => e.detail).length;
          const displayMessage = messageOf(stage, status);

          return (
            <li key={stage.key}>
              <button
                onClick={() => (entries.length || status === "done") && toggle(stage.key)}
                disabled={!entries.length && status !== "done"}
                aria-expanded={isOpen}
                className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors ${entries.length || status === "done" ? "hover:bg-[color:var(--color-surface-3)] cursor-pointer" : "cursor-default"}`}
              >
                <span className="mt-0.5 flex-shrink-0">
                  {status === "done" && <span className="w-5 h-5 rounded-full bg-emerald-500 grid place-items-center"><Check className="w-3 h-3 text-white" strokeWidth={3} /></span>}
                  {status === "active" && <LoaderCircle className="w-5 h-5 text-blue-500 animate-spin" />}
                  {status === "error" && <span className="w-5 h-5 rounded-full bg-red-500 grid place-items-center"><TriangleAlert className="w-3 h-3 text-white" /></span>}
                  {status === "pending" && <CircleDashed className="w-5 h-5 text-[color:var(--color-text-faint)]" />}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-[color:var(--color-text-faint)]">{String(index + 1).padStart(2, "0")}</span>
                    <span className={`text-sm font-medium ${status === "pending" ? "text-[color:var(--color-text-faint)]" : "text-[color:var(--color-text)]"}`}>{stage.title}</span>
                    {status === "done" && (
                      <span className="font-mono text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold uppercase">done</span>
                    )}
                    {status === "pending" && index === doneCount && (
                      <span className="font-mono text-[9px] px-1.5 py-0.2 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-bold uppercase">ready to run</span>
                    )}
                    {live && live.total > 1 && (
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-300">{live.completed}/{live.total}</span>
                    )}
                  </span>
                  <span className={`block text-[12px] mt-0.5 truncate ${status === "done" ? "text-emerald-700 dark:text-emerald-300" : "text-[color:var(--color-text-soft)]"}`}>
                    {displayMessage}
                  </span>
                  {live && live.total > 1 && (
                    <span className="block mt-2 h-1 rounded-full bg-[color:var(--color-surface-3)] overflow-hidden">
                      <span className="block h-full bg-blue-500 transition-all duration-300" style={{ width: `${Math.round((live.completed / Math.max(1, live.total)) * 100)}%` }} />
                    </span>
                  )}

                  {!running && (
                    <div className="flex flex-wrap items-center gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
                      {/* Continue button directly on the failed phase */}
                      {status === "error" && onContinue && (
                        <button
                          type="button"
                          onClick={onContinue}
                          className="px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold flex items-center gap-1 shadow-sm transition-colors cursor-pointer"
                          title="Continue generation from where it was left off"
                        >
                          <Play className="w-3 h-3 fill-current" />
                          Continue from this step
                        </button>
                      )}

                      {/* Stage 1: Read transcript & lock word timing */}
                      {stage.key === "1_preprocessor" && onStartFromStage && (
                        <button
                          type="button"
                          onClick={() => onStartFromStage("audio-align")}
                          className="px-2.5 py-1 rounded bg-[color:var(--color-surface-2)] hover:bg-[color:var(--color-surface-3)] border border-[color:var(--color-border)] text-[10px] font-medium text-[color:var(--color-text-soft)] hover:text-[color:var(--color-text)] flex items-center gap-1.5 transition-colors cursor-pointer"
                          title="Re-run audio transcription and word-level alignment"
                        >
                          <RotateCcw className="w-2.5 h-2.5" />
                          Restart word timing
                        </button>
                      )}

                      {/* Stage 2: Plan what each spoken beat shows */}
                      {stage.key === "2_planner" && onStartFromStage && (
                        <button
                          type="button"
                          onClick={() => onStartFromStage("planning")}
                          className="px-2.5 py-1 rounded bg-[color:var(--color-surface-2)] hover:bg-[color:var(--color-surface-3)] border border-[color:var(--color-border)] text-[10px] font-medium text-[color:var(--color-text-soft)] hover:text-[color:var(--color-text)] flex items-center gap-1.5 transition-colors cursor-pointer"
                          title="Start over and plan the storyboard beats from scratch"
                        >
                          <RotateCcw className="w-2.5 h-2.5" />
                          Start over from planning
                        </button>
                      )}

                      {/* Stage 3: Write the visual prompt per shot */}
                      {stage.key === "3_art-direction" && onStartFromStage && (
                        <button
                          type="button"
                          onClick={() => onStartFromStage("art-direction")}
                          className="px-2.5 py-1 rounded bg-[color:var(--color-surface-2)] hover:bg-[color:var(--color-surface-3)] border border-[color:var(--color-border)] text-[10px] font-medium text-[color:var(--color-text-soft)] hover:text-[color:var(--color-text)] flex items-center gap-1.5 transition-colors cursor-pointer"
                          title="Re-author visual prompts for all shots, then re-generate code"
                        >
                          <RotateCcw className="w-2.5 h-2.5" />
                          Start over from prompts
                        </button>
                      )}

                      {/* Stage 4: Generate Remotion code */}
                      {stage.key === "4_codegen" && onStartFromStage && (
                        <button
                          type="button"
                          onClick={() => onStartFromStage("coding")}
                          className="px-2.5 py-1 rounded bg-[color:var(--color-surface-2)] hover:bg-[color:var(--color-surface-3)] border border-[color:var(--color-border)] text-[10px] font-medium text-[color:var(--color-text-soft)] hover:text-[color:var(--color-text)] flex items-center gap-1.5 transition-colors cursor-pointer"
                          title="Keep storyboard and prompts, and re-write Remotion TSX code for all scenes"
                        >
                          <RotateCcw className="w-2.5 h-2.5" />
                          Start over from code
                        </button>
                      )}

                      {/* Stage 5: Compile & smoke-render */}
                      {stage.key === "5_validator" && onStartFromStage && (
                        <button
                          type="button"
                          onClick={() => onStartFromStage("validation")}
                          className="px-2.5 py-1 rounded bg-[color:var(--color-surface-2)] hover:bg-[color:var(--color-surface-3)] border border-[color:var(--color-border)] text-[10px] font-medium text-[color:var(--color-text-soft)] hover:text-[color:var(--color-text)] flex items-center gap-1.5 transition-colors cursor-pointer"
                          title="Re-compile and verify all scenes without calling LLM"
                        >
                          <RotateCcw className="w-2.5 h-2.5" />
                          Re-run validation & compile
                        </button>
                      )}
                    </div>
                  )}
                </span>

                {entries.length > 0 && (
                  <span className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                    {detailCount > 0 && <span className="font-mono text-[10px] text-[color:var(--color-text-faint)]">{detailCount}</span>}
                    <ChevronRight className={`w-4 h-4 text-[color:var(--color-text-faint)] transition-transform ${isOpen ? "rotate-90" : ""}`} />
                  </span>
                )}
              </button>

              {isOpen && entries.length > 0 && (
                <div className="px-4 pb-4 pl-12 space-y-2">
                  {entries.map((entry, i) => (
                    <LogEntry key={`${entry.timestamp}-${i}`} entry={entry} />
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {running && activeIndex === -1 && (
        <div className="px-4 py-2 text-[11px] text-[color:var(--color-text-faint)] border-t border-[color:var(--color-border)]">Starting…</div>
      )}
    </section>
  );
}

function LogEntry({ entry }: { entry: PipelineLog }) {
  const [open, setOpen] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const isCode = entry.detail?.includes("--- generated Remotion TSX ---");

  return (
    <div className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface-2)] overflow-hidden">
      <button
        onClick={() => entry.detail && setOpen((v) => !v)}
        disabled={!entry.detail}
        className={`w-full text-left px-3 py-2 flex items-start gap-2 ${entry.detail ? "hover:bg-[color:var(--color-surface-3)] cursor-pointer" : "cursor-default"}`}
      >
        <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${entry.status === "success" ? "bg-emerald-500" : entry.status === "error" ? "bg-red-500" : "bg-amber-500"}`} />
        <span className="text-[12px] leading-relaxed text-[color:var(--color-text-soft)] flex-1 min-w-0">{entry.message}</span>
        {entry.detail && (
          <span className="flex items-center gap-1 flex-shrink-0 font-mono text-[10px] text-[color:var(--color-text-faint)]">
            {isCode ? "code" : "details"}
            <ChevronRight className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`} />
          </span>
        )}
      </button>
      {open && entry.detail && (
        <pre
          ref={preRef}
          className="px-3 pb-3 pt-1 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words max-h-80 overflow-auto text-[color:var(--color-text-soft)] border-t border-[color:var(--color-border)]"
        >
          {entry.detail}
        </pre>
      )}
    </div>
  );
}
