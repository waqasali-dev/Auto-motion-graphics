// src/components/Pipeline.tsx
// Visualises the 5-stage deterministic pipeline.

import { tokens } from "../sdk/primitives";

const STAGES = [
  {
    n: "01",
    title: "Deterministic Pre-Processor",
    file: "1_preprocessor.ts",
    summary: "Ingest transcript JSON. Strip onsets/chunks. Flag ASR typos where confidence < 0.5 or adjacent duplicate words — without mutating timestamps.",
    output: "[S{idx} | {start}s–{end}s | words:{a}..{b}] \"text\"",
    accent: "blue",
  },
  {
    n: "02",
    title: "Master Planner Agent",
    file: "2_planner.ts",
    summary: "One-shot LLM call consumes the compact digest and emits a strict ShotPlan JSON. No float timestamps — only sentenceStartIndex / sentenceEndIndex.",
    output: "ShotPlan.json · 8 archetype enum · 8s–15s per shot",
    accent: "blue",
  },
  {
    n: "03",
    title: "Frame-Lock Middleware",
    file: "3_middleware.ts",
    summary: "Pure TS computes shot frame boundaries at 60fps. Shot[N].startFrame = Shot[N−1].endFrame (zero gaps). Normalises word times to local shot t=0 with 4-frame vocal pre-roll.",
    output: "localStartFrame, localSpokenEndFrame, pauseFrames",
    accent: "blue",
  },
  {
    n: "04",
    title: "Parallel Shot Workers",
    file: "4_workers.ts",
    summary: "Promise.all with concurrency 5. Each worker sees only its own shot's normalised words + SDK types. Every return must wrap in <ShotEnvelope />.",
    output: "/generated/shots/Shot_01.tsx … Shot_NN.tsx",
    accent: "blue",
  },
  {
    n: "05",
    title: "AST & Smoke Validator",
    file: "5_validator.ts",
    summary: "ESBuild compiles each file. renderStill() at frames 0, ⌊d/2⌋, d−1. Auto-heal feeds exact trace back to worker (max 2 retries). Falls back to <DefaultKineticScene />.",
    output: "ShotRegistry.ts · clean Remotion master render",
    accent: "red",
  },
];

export function Pipeline() {
  return (
    <div className="relative">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {STAGES.map((s, i) => (
          <div
            key={s.n}
            className="md:col-span-12 group relative"
          >
            <div className="grid grid-cols-12 gap-6 items-start">
              {/* index */}
              <div className="col-span-12 md:col-span-2 md:sticky md:top-20">
                <div className="flex md:flex-col items-baseline gap-3">
                  <div
                    className="text-6xl md:text-7xl font-bold tabular-nums"
                    style={{
                      color: "transparent",
                      WebkitTextStroke: `1px ${tokens.primaryText}`,
                      fontFamily: tokens.fontFamily,
                    }}
                  >
                    {s.n}
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-[color:var(--color-ink-soft)]">
                    stage · {i + 1} / 5
                  </div>
                </div>
              </div>

              {/* content */}
              <div className="col-span-12 md:col-span-10 border border-[color:var(--color-rule)] rounded-2xl p-6 md:p-8 bg-white hover:border-[color:var(--color-ink)]/20 transition-colors">
                <div className="flex flex-wrap items-center gap-3 mb-4">
                  <h3 className="text-2xl md:text-3xl font-semibold text-[color:var(--color-ink)]">
                    {s.title}
                  </h3>
                  <code
                    className="font-mono text-[10px] uppercase tracking-widest px-2 py-1 rounded-md border"
                    style={{
                      borderColor: s.accent === "blue" ? tokens.electricBlue : tokens.coralRed,
                      color: s.accent === "blue" ? tokens.electricBlue : tokens.coralRed,
                      background: s.accent === "blue" ? "rgba(0,102,255,0.06)" : "rgba(229,57,53,0.06)",
                    }}
                  >
                    {s.file}
                  </code>
                </div>

                <p className="text-[color:var(--color-ink-soft)] leading-relaxed max-w-3xl">
                  {s.summary}
                </p>

                <div className="mt-5 rounded-xl border border-[color:var(--color-rule)] bg-[color:var(--color-paper)] p-4">
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--color-ink-soft)] mb-1.5">
                    → emits
                  </div>
                  <code
                    className="font-mono text-sm text-[color:var(--color-ink)]"
                    style={{ color: tokens.primaryText }}
                  >
                    {s.output}
                  </code>
                </div>

                {/* Connecting rule */}
                {i < STAGES.length - 1 && (
                  <div className="hidden md:block absolute -bottom-6 left-[8%] w-px h-6" style={{ background: tokens.rule }} />
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
