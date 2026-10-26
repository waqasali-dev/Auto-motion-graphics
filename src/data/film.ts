// src/data/film.ts
// The 14-beat film, in narrative order. Each beat is copy and data only. The
// variety planner decides which grammar renders it, and the frame pass decides
// when it runs. Intents are chosen so only layouts that can show the content
// are candidates.

import type { Beat } from "../sdk/contract";
import { IMG } from "../sdk/kit";

export const FILM_TITLE = "Case 04 · the 40-second spot";

export const FILM_BEATS: Beat[] = [
  // Act I · Hook
  {
    intent: "hook",
    kicker: "case study · 40 sec spot",
    headline: "this 40-second spot took just",
    figures: [{ value: "20 mins", label: "start to render" }],
    spoken: "This 40-second spot took just 20 minutes.",
    durationFrames: 270,
  },
  {
    intent: "trend",
    kicker: "manual edit hours",
    headline: "Hand-cut revisions compounded every single week.",
    accentWord: "compounded",
    series: [4, 9, 14, 21, 30, 38],
    seriesLabels: ["W1", "W2", "W3", "W4", "W5", "W6"],
    figures: [{ value: "38 h", label: "week six, alone" }],
    durationFrames: 300,
  },

  // Act II · Evidence
  {
    intent: "evidence",
    kicker: "case 04 · the audit",
    headline: "Every cut traces back to one transcript.",
    accentWord: "one transcript",
    evidence: [
      { tag: "input", title: "Transcript.json", note: "1,092 words · ASR confidence kept" },
      { tag: "plan", title: "ShotPlan.json", note: "14 shots · indices, never floats" },
      { tag: "render", title: "Master.mp4", note: "60 fps · zero timeline gaps" },
    ],
    durationFrames: 330,
  },
  {
    intent: "system",
    kicker: "parallel workers",
    headline: "One planner. Five workers. One validator.",
    nodes: ["Transcript", "Planner", "Worker 01", "Worker 02", "Worker 03", "Worker 04", "Worker 05", "Validator"],
    figures: [{ value: "5", label: "parallel workers" }],
    durationFrames: 300,
  },
  {
    intent: "search",
    kicker: "search · the slow part",
    headline: "Where did the hours actually go?",
    query: "where did the time go",
    results: [
      { title: "Scrubbing frames by hand", source: "edit log · day 2", score: 0.94 },
      { title: "Re-exporting after each note", source: "review thread · v3", score: 0.81 },
      { title: "Waiting on a render queue", source: "ops log · Friday", score: 0.67 },
      { title: "Manual caption timing", source: "QA sheet · row 88", score: 0.52 },
    ],
    durationFrames: 300,
  },
  {
    intent: "inspect",
    kicker: "row 214 · flagged",
    headline: "One word was wrong. The lens found it.",
    rows: [
      { cells: ["00:38.10", "this", "0.99"] },
      { cells: ["00:38.34", "forty", "0.98"] },
      { cells: ["00:38.71", "second", "0.97"] },
      { cells: ["00:39.02", "spot", "0.99"] },
      { cells: ["00:39.40", "took", "0.98"] },
      { cells: ["00:40.06", "lowcon fidence", "0.42"], flag: true, fix: "low-confidence" },
      { cells: ["00:40.40", "just", "0.96"] },
      { cells: ["00:40.71", "20 mins", "0.99"] },
    ],
    durationFrames: 300,
  },

  // Act III · Proof
  {
    intent: "compare",
    kicker: "time to a finished cut",
    headline: "Build time fell on every single stage.",
    bars: [
      { label: "Manual timeline", value: 100 },
      { label: "Agency review", value: 62 },
      { label: "Frame/60 pass", value: 2 },
    ],
    figures: [{ value: "−98%", label: "time to a finished cut" }],
    durationFrames: 300,
  },
  {
    intent: "contrast",
    kicker: "before / after",
    headline: "Three days became twenty minutes.",
    figures: [
      { value: "3 days", label: "manual timeline edits" },
      { value: "20 min", label: "frame-locked render" },
    ],
    image: IMG.wrist,
    durationFrames: 300,
  },
  {
    intent: "proof",
    kicker: "one browser tab",
    headline: "Every asset and every cut lives in one place.",
    durationFrames: 300,
  },
  {
    intent: "summary",
    kicker: "timing lock",
    headline: "Every shot carries its own timing proof.",
    figures: [
      { value: "18 / 18", label: "shots locked" },
      { value: "12", label: "checks passed" },
    ],
    durationFrames: 270,
  },
  {
    intent: "trace",
    kicker: "drift audit",
    headline: "Every word lands on an integer frame. Drift is zero.",
    figures: [{ value: "0", label: "frames of drift" }],
    nodes: ["Word", "Frame", "Shot", "Render", "Check", "Master"],
    durationFrames: 270,
  },

  // Act IV · Resolve
  {
    intent: "stat",
    kicker: "AD",
    headline: "Forty seconds of finished film.",
    figures: [{ value: "40", label: "sec" }],
    image: IMG.dark,
    durationFrames: 270,
  },
  {
    intent: "summary",
    kicker: "sdk · locked",
    headline: "No raw CSS. One locked SDK.",
    figures: [{ value: "0", label: "raw CSS lines" }],
    image: IMG.flatlay,
    durationFrames: 270,
  },
  {
    intent: "close",
    kicker: "end of transcript",
    headline: "The voice leads. The frames obey.",
    image: IMG.wrist,
    durationFrames: 270,
  },
];
