// src/sdk/contract.pipeline.ts
// Locked Spec Data Contracts — Stage-by-stage types matching master spec
// This file documents exactly what each pipeline stage expects and emits.

/**
 * STAGE 1 Input: Raw Transcript JSON (Whisper/ASR style)
 * Matches spec: ingest audio, words, sentences, silences
 */
export interface RawTranscriptJSON {
  audio: { durationSec: number; sampleRate?: number; url?: string };
  words: Array<{
    text: string;
    start: number; // seconds
    spokenEnd: number;
    end: number; // includes pause
    confidence: number;
    onset?: number; // stripped
    chunks?: unknown[]; // stripped
  }>;
  sentences: Array<{
    index: number;
    start: number;
    spokenEnd: number;
    end: number;
    text: string;
    wordStart: number;
    wordEnd: number;
  }>;
  silences?: Array<{ start: number; end: number }>;
}

/**
 * STAGE 1 Output: Compact Digest for Planner
 * Format: [S{index} | {start}s-{end}s | words:{wordStart}..{wordEnd}] "{text}"
 */
export interface PreprocessorDigest {
  digestLines: string[];
  flaggedSentences: Array<{ sentenceIndex: number; reason: string; confidence?: number }>;
  compactSentences: Array<{ index: number; start: number; end: number; text: string; wordStart: number; wordEnd: number }>;
  words: RawTranscriptJSON["words"];
  originalDuration: number;
}

/**
 * STAGE 2 Output: Strict ShotPlan JSON
 * Planner is FORBIDDEN from outputting raw timestamps — only indices
 */
export type ArchetypeEnum =
  | "KineticHero"
  | "SplitComparison"
  | "PerspectiveDataGrid"
  | "RadialHub"
  | "DeviceMockup"
  | "BentoBadgeCluster"
  | "ScaleTradeoff"
  | "DarkImpactClose"
  | "ChartStory"
  | "BarComparison"
  | "NetworkMesh"
  | "InvestigationBoard"
  | "MagnifierInspect"
  | "QueryTrace";

/** Full shot plan schema — exact spec + extended archetypes */
export interface ShotPlanItem {
  shotId: string; // "Shot_01"
  sentenceStartIndex: number;
  sentenceEndIndex: number;
  cleanedDisplaySentences: string[]; // ASR typos fixed for on-screen text
  archetype: ArchetypeEnum;
  themeMode: "light" | "dark";
  highlightWords: Array<{ wordIndex: number; tone: "blue" | "red" | "green" | "cyan" | "gold" }>;
  visualInstructions: string; // detailed choreography mapping words to SDK components
}

export interface ShotPlanJSON {
  shots: ShotPlanItem[];
  meta?: { totalSentences: number; totalWords: number; durationSec: number };
}

/**
 * STAGE 3 Output: Frame-Locked Manifest
 * Pure TS function computing exact frame boundaries at 60fps
 */
export interface FrameLockedShot {
  shotId: string;
  startFrame: number;
  endFrame: number;
  durationFrames: number;
  sentenceStartIndex: number;
  sentenceEndIndex: number;
  localWords: Array<{
    text: string;
    localStartFrame: number;
    localSpokenEndFrame: number;
    pauseFrames: number;
    confidence: number;
  }>;
  archetype: ArchetypeEnum;
  themeMode: "light" | "dark";
  highlightWords: ShotPlanItem["highlightWords"];
  visualInstructions: string;
  cleanedDisplaySentences: string[];
}

/**
 * STAGE 4 Input: Single shot worker payload
 * Each worker receives ONLY its normalized local word list + definitions
 */
export interface WorkerPayload {
  shotPlan: FrameLockedShot;
  sdkDefinitions: string; // TS definitions as string for LLM context
}

/**
 * STAGE 5: Validator result
 */
export interface ValidationResult {
  shotId: string;
  esbuildOK: boolean;
  smokeFrames: { frame: number; ok: boolean; error?: string }[];
  retries: number;
  finalComponent: string | null; // path to generated file or fallback
}
