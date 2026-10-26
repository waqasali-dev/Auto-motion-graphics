// src/components/PipelineProgress.tsx
// Minimal by default, deep on demand: each stage shows one clear heading and a
// one-line status. Expanding a stage reveals the model's actual working —
// storyboard beats, art-direction prompts, generated TSX and validation traces.

import { useEffect, useMemo, useRef, useState } from "react";
import type { PipelineLog } from "../services/projects";
import { Check, ChevronRight, CircleDashed, LoaderCircle, TriangleAlert } from "lucide-react";

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
}: {
  logs: PipelineLog[];
  stageProgress: StageProgress | null;
  running: boolean;
  startedAt: number | null;
}) {
  const [expanded, setExpanded] = useState<Set<StageKey>>(new Set());
  const [now, setNow] = useState(() => Date.now());

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
        // Attribute to the currently in-progress stage, or default to the last stage
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
    if (entries.some((e) => e.status === "error")) return "error";
    if (entries.some((e) => e.status === "success")) return "done";
    if (entries.length) return running ? "active" : "done";
    return "pending";
  };

  const activeIndex = STAGES.findIndex((s) => statusOf(s.key) === "active");
  const doneCount = STAGES.filter((s) => statusOf(s.key) === "done").length;
  const overall = Math.round((doneCount / STAGES.length) * 100);
  const hasError = STAGES.some((s) => statusOf(s.key) === "error");

  const toggle = (key: StageKey) =>
    setExpanded((old) => {
      const next = new Set(old);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (!logs.length && !running) return null;

  return (
    <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] overflow-hidden">
      <header className="px-4 py-3 border-b border-[color:var(--color-border)] flex items-center gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[color:var(--color-text)]">
            {hasError ? "Generation stopped" : running ? "Building your film" : "Film ready"}
          </h3>
          <p className="text-[11px] text-[color:var(--color-text-faint)] truncate">
            {hasError
              ? "Expand the failed stage to read the exact error."
              : running
                ? stageProgress?.message || "Working…"
                : `${STAGES.length} stages complete`}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {startedAt && <span className="font-mono text-[11px] text-[color:var(--color-text-faint)] tabular-nums">{elapsedLabel((running ? now : logs.at(-1)?.timestamp ?? now) - startedAt)}</span>}
          <span className="font-mono text-[11px] text-[color:var(--color-text-soft)] tabular-nums">{overall}%</span>
        </div>
      </header>

      <div className="h-0.5 bg-[color:var(--color-surface-3)]">
        <div
          className={`h-full transition-all duration-500 ${hasError ? "bg-red-500" : "bg-blue-500"}`}
          style={{ width: `${hasError ? 100 : overall}%` }}
        />
      </div>

      <ol className="divide-y divide-[color:var(--color-border)]">
        {STAGES.map((stage, index) => {
          const status = statusOf(stage.key);
          const entries = byStage.get(stage.key) ?? [];
          const isOpen = expanded.has(stage.key);
          const latest = [...entries].reverse().find((e) => e.message);
          const live = stageProgress && stage.maps === stageProgress.stage && status === "active" ? stageProgress : null;
          const detailCount = entries.filter((e) => e.detail).length;

          return (
            <li key={stage.key}>
              <button
                onClick={() => entries.length && toggle(stage.key)}
                disabled={!entries.length}
                aria-expanded={isOpen}
                className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors ${entries.length ? "hover:bg-[color:var(--color-surface-3)] cursor-pointer" : "cursor-default"}`}
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
                    {live && live.total > 1 && (
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-300">{live.completed}/{live.total}</span>
                    )}
                  </span>
                  <span className="block text-[12px] text-[color:var(--color-text-soft)] mt-0.5 truncate">
                    {status === "pending" ? stage.blurb : live ? live.message : latest?.message || stage.blurb}
                  </span>
                  {live && live.total > 1 && (
                    <span className="block mt-2 h-1 rounded-full bg-[color:var(--color-surface-3)] overflow-hidden">
                      <span className="block h-full bg-blue-500 transition-all duration-300" style={{ width: `${Math.round((live.completed / Math.max(1, live.total)) * 100)}%` }} />
                    </span>
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
