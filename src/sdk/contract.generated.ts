// Contracts for the AI-authored Remotion workflow.
// These describe creative intent and generated source, not a fixed archetype.

import type { ActId, Family, ThemeMode, Transition } from "./contract";

export interface WordCue {
  wordIndex: number;
  sentenceIndex: number;
  text: string;
  startFrame: number;
  spokenEndFrame: number;
  pauseFrames: number;
  confidence: number;
}

export type ShotEnergy = 1 | 2 | 3;

/** Planner output: what the audience should understand from this beat. */
export interface CreativeShotPlan {
  shotId: string;
  sentenceStartIndex: number;
  sentenceEndIndex: number;
  wordStartIndex: number;
  wordEndIndex: number;
  spokenText: string;
  cleanedDisplaySentences: string[];
  purpose: string;
  visualIdea: string;
  keyEvidence: string[];
  emphasisWordIndices: number[];
  visualFamily: Family;
  act: ActId;
  themeMode: ThemeMode;
  energy: ShotEnergy;
  transitionIn: Transition;
  transitionDirection: 1 | -1;
  continuityNote: string;
}

export type CreativePlanDraftShot = Omit<CreativeShotPlan, "wordStartIndex" | "wordEndIndex" | "act">;

/** Second model stage: precise art direction for one independently authored shot. */
export interface ShotVisualPrompt {
  shotId: string;
  premise: string;
  composition: string;
  visualMetaphor: string;
  elements: string[];
  cameraChoreography: string;
  typographyChoreography: string;
  wordSync: Array<{
    wordIndex: number;
    action: string;
    completesBySpokenEnd: boolean;
  }>;
  colorAndLight: string;
  soundAwareCut: string;
  avoid: string[];
  renderPrompt: string;
}

export type GeneratedCodeStatus = "planned" | "prompted" | "generating" | "compiled" | "smoke-passed" | "error";

/** A validated, generated Remotion component for one voice-aligned shot. */
export interface GeneratedSceneShot extends CreativeShotPlan {
  startFrame: number;
  endFrame: number;
  durationFrames: number;
  wordCues: WordCue[];
  visualPrompt?: ShotVisualPrompt;
  sourceCode: string;
  sourceHash: string;
  visualSummary: string;
  designChoices: string[];
  codeStatus: GeneratedCodeStatus;
  retries: number;
  compileError?: string;
  continuity: {
    previousVisualSummary: string;
    nextVisualSummary: string;
    paletteAnchor: string;
    typeAnchor: string;
  };
}

export interface GeneratedFilm {
  id: string;
  title: string;
  width: 1920;
  height: 1080;
  fps: 60;
  durationInFrames: number;
  audioDurationSec: number;
  transcript: string;
  sourceTranscript: string;
  alignment: "word-json" | "whisper-aligned" | "estimated";
  alignmentConfidence: number;
  sourceAudioName?: string;
  wordCues: WordCue[];
  shots: GeneratedSceneShot[];
  visualContinuity: {
    palette: string;
    typography: string;
    texture: string;
    rules: string[];
  };
  model: string;
  createdAt: number;
}

export interface CreativePlanOutput {
  filmTitle: string;
  creativeNorthStar: string;
  palette: string;
  typography: string;
  texture: string;
  continuityRules: string[];
  shots: CreativePlanDraftShot[];
}

export interface GeneratedCodeOutput {
  sourceCode: string;
  visualSummary: string;
  usedWordIndices: number[];
  designChoices: string[];
}