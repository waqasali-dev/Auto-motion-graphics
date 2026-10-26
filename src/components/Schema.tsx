// src/components/Schema.tsx
// Displays the ShotPlan schema and the four enforcement clauses injected into worker prompts.

import { tokens } from "../sdk/primitives";

const SCHEMA = `{
  "shotId": "Shot_01",
  "sentenceStartIndex": 0,
  "sentenceEndIndex": 3,
  "cleanedDisplaySentences": ["..."],
  "archetype":
    "KineticHero" | "SplitComparison" |
    "PerspectiveDataGrid" | "RadialHub" |
    "DeviceMockup" | "BentoBadgeCluster" |
    "ScaleTradeoff" | "DarkImpactClose",
  "themeMode": "light" | "dark",
  "highlightWords": [
    { "wordIndex": 2, "tone": "blue" | "red" }
  ],
  "visualInstructions": "string"
}`;

const CLAUSES = [
  {
    tag: "01",
    title: "Zero Raw CSS / Positioning",
    body: "Workers never write position: absolute with arbitrary pixel coordinates. All layout comes from /src/sdk archetype components and primitives only.",
  },
  {
    tag: "02",
    title: "Spoken-End Sync",
    body: "All word/card entry animations must complete by localSpokenEndFrame. Secondary micro-motion (counter ticks, progress fill, subtle float) requires pauseFrames ≥ 25.",
  },
  {
    tag: "03",
    title: "Density Cap",
    body: "Maximum 1 primary headline and ≤ 6 cards visible simultaneously. Lists with ≥ 4 items must use <BentoBadgeCluster /> or cycling <CardStack maxVisible={4} />.",
  },
  {
    tag: "04",
    title: "Anti-Repetition Gate",
    body: "Middleware rejects any ShotPlan where Shot[N].archetype === Shot[N−1].archetype, or where 'dark' theme exceeds 15% of total shots.",
  },
];

export function Schema() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-6 bg-[color:var(--color-dark)] text-[color:var(--color-primary-text-dark)] rounded-2xl overflow-hidden border border-[color:var(--color-rule-dark)]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[color:var(--color-rule-dark)]">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ background: tokens.coralRed }} />
            <span className="w-2 h-2 rounded-full" style={{ background: "#febc2e" }} />
            <span className="w-2 h-2 rounded-full" style={{ background: "#28c840" }} />
            <span className="ml-3 font-mono text-[10px] uppercase tracking-[0.25em]" style={{ color: tokens.inkSoft }}>
              Stage 2 · ShotPlan.schema.json
            </span>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.25em]" style={{ color: tokens.electricBlue }}>
            strict
          </span>
        </div>
        <pre className="px-5 py-5 font-mono text-[12px] md:text-[13px] leading-relaxed overflow-x-auto">
          <code style={{ color: "#E5EAF2" }}>
            {SCHEMA.split("\n").map((line, i) => (
              <div key={i} className="flex">
                <span className="select-none pr-4 opacity-40 tabular-nums" style={{ color: tokens.inkSoft, minWidth: 32, textAlign: "right", display: "inline-block" }}>
                  {(i + 1).toString().padStart(2, "0")}
                </span>
                <span dangerouslySetInnerHTML={{ __html: colourise(line) }} />
              </div>
            ))}
          </code>
        </pre>
      </div>

      <div className="lg:col-span-6 grid grid-cols-1 gap-3">
        <div className="mb-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-[color:var(--color-ink-soft)]">
            Enforcement · injected into worker system prompt
          </div>
        </div>
        {CLAUSES.map((c) => (
          <div
            key={c.tag}
            className="rounded-2xl border border-[color:var(--color-rule)] bg-white p-5 flex gap-4"
          >
            <div className="font-mono text-xs font-semibold tabular-nums pt-1" style={{ color: tokens.electricBlue }}>
              §{c.tag}
            </div>
            <div>
              <div className="font-semibold text-[color:var(--color-ink)] mb-1">{c.title}</div>
              <div className="text-sm text-[color:var(--color-ink-soft)] leading-relaxed">{c.body}</div>
            </div>
          </div>
        ))}
        <div className="rounded-2xl border border-dashed border-[color:var(--color-rule)] p-4 flex gap-3 items-start">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] pt-0.5 flex-shrink-0" style={{ color: tokens.inkSoft }}>
            note
          </span>
          <div className="text-xs text-[color:var(--color-ink-soft)] leading-relaxed">
            The demo above deliberately cuts four dark and four light shots to exercise palette contrast. In production the planner applies the 15% dark cap; this showcase opts out so you can judge both modes.
          </div>
        </div>
      </div>
    </div>
  );
}

// Tiny syntax colouriser for the schema display
function colourise(line: string) {
  let html = escape(line);
  html = html.replace(/"([^"]+)":/g, `<span style="color:${tokens.electricBlue}">"$1"</span><span style="color:#E5EAF2">:</span>`);
  html = html.replace(/: "([^"]+)"/g, `: <span style="color:#22c55e">"$1"</span>`);
  html = html.replace(/\|/g, `<span style="color:${tokens.coralRed}">|</span>`);
  html = html.replace(/"string"/g, `<span style="color:#febc2e">"string"</span>`);
  html = html.replace(/"number"/g, `<span style="color:#febc2e">"number"</span>`);
  return html;
}

function escape(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
