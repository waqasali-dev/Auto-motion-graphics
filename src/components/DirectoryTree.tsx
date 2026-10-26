// src/components/DirectoryTree.tsx
// ASCII directory tree of the project structure.

import { tokens } from "../sdk/primitives";

const TREE = [
  { depth: 0, name: "/src", kind: "dir" },
  { depth: 1, name: "/pipeline", kind: "dir", note: "locked spec — 5 stages" },
  { depth: 2, name: "1_preprocessor.ts", kind: "file", note: "strips bloat · flags ASR typos" },
  { depth: 2, name: "2_planner.ts", kind: "file", note: "1-shot LLM → ShotPlan.json (env: VITE_OPENAI_*)" },
  { depth: 2, name: "3_middleware.ts", kind: "file", note: "sentence → 60fps frames (pure TS)" },
  { depth: 2, name: "4_workers.ts", kind: "file", note: "parallel <Shot_XX /> via locked SDK" },
  { depth: 2, name: "5_validator.ts", kind: "file", note: "ESBuild AST + 3-frame smoke test" },
  { depth: 1, name: "/sdk", kind: "dir", note: "locked template SDK" },
  { depth: 2, name: "AmbientCanvas.tsx", kind: "file", note: "dot-grids · rings · wash" },
  { depth: 2, name: "ShotEnvelope.tsx", kind: "file", note: "10f entry / 12f exit blur-fade" },
  { depth: 2, name: "primitives.tsx", kind: "file", note: "safeInterpolate · useWordSpring" },
  { depth: 2, name: "registry.ts", kind: "file", note: "14 archetypes → mg scenes (1920×1080)" },
  { depth: 1, name: "/services", kind: "dir", note: "browser pipeline + storage" },
  { depth: 2, name: "env.ts", kind: "file", note: "reads .env + localStorage override" },
  { depth: 2, name: "openai.ts", kind: "file", note: "OpenAI SDK · structured outputs + Whisper" },
  { depth: 2, name: "pipeline.ts", kind: "file", note: "orchestrates 1→5 stages" },
  { depth: 2, name: "projects.ts", kind: "file", note: "local-first store (IndexedDB + localStorage)" },
  { depth: 1, name: "/mg", kind: "dir", note: "motion-graphics engine" },
  { depth: 2, name: "core.tsx", kind: "file", note: "1920×1080 comp · keyframes · motion blur · 60fps" },
  { depth: 2, name: "stage.tsx", kind: "file", note: "the edit · whip · zoom · punch · act wipe · audio sync" },
  { depth: 2, name: "/scenes", kind: "dir", note: "editorial · data · case (14 grammars)" },
  { depth: 1, name: "/hooks", kind: "dir", note: "useAudioSync — audio.currentTime → frame" },
  { depth: 2, name: "useAudioSync.ts", kind: "file", note: "audio element is the clock (60fps)" },
  { depth: 1, name: "/components", kind: "dir", note: "Studio · Projects · Player" },
  { depth: 2, name: "Studio.tsx", kind: "file", note: "upload audio+transcript → generate → preview" },
  { depth: 2, name: "ProjectsDashboard.tsx", kind: "file", note: "CRUD · no DB · export/import" },
  { depth: 2, name: "ShotPlayer.tsx", kind: "file", note: "FilmStage + timeline + contact sheet" },
];

export function DirectoryTree() {
  return (
    <div className="rounded-2xl bg-[color:var(--color-dark)] text-[color:var(--color-primary-text-dark)] border border-[color:var(--color-rule-dark)] overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[color:var(--color-rule-dark)]">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em]" style={{ color: tokens.inkSoft }}>
          project structure
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.25em]" style={{ color: tokens.electricBlue }}>
          17 files · 60fps locked
        </span>
      </div>
      <div className="px-5 py-4 font-mono text-[12px] leading-[1.9]">
        {TREE.map((row, i) => {
          const indent = "  ".repeat(row.depth);
          const connector = row.depth > 0 ? (i === TREE.length - 1 ? "└── " : "├── ") : "";
          const isDir = row.kind === "dir";
          return (
            <div key={i} className="flex items-baseline gap-3">
              <span style={{ color: isDir ? tokens.electricBlue : "#E5EAF2", whiteSpace: "pre" }}>
                {indent}
                <span style={{ color: tokens.inkSoft }}>{connector}</span>
                {isDir ? <span style={{ fontWeight: 600 }}>{row.name}</span> : row.name}
              </span>
              {row.note && (
                <span className="ml-auto text-[10px] uppercase tracking-widest" style={{ color: tokens.inkSoft }}>
                  · {row.note}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
