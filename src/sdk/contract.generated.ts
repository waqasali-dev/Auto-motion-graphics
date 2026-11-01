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

export type EntityCategory = "person" | "historical" | "product" | "organization" | "location" | "object";

/** AI-detected entity that requires an image for optimal video presentation. */
export interface EntityImageRequirement {
  id: string;                       // Standardized snake_case slug (e.g. "king_baldwin", "elon_musk")
  name: string;                     // Human-readable title (e.g. "King Baldwin IV")
  targetFilename: string;           // Canonical filename prefix without extension (e.g. "king_baldwin")
  category: EntityCategory;
  rationale: string;                // Why an image enhances comprehension of this narrative beat
  suggestedFraming: "portrait" | "landscape" | "square" | "transparent_cutout";
  recommendedResolution?: string;  // e.g. "min 1080p, portrait aspect ratio"
  importance: "essential" | "recommended" | "optional";
  sentenceIndices: number[];        // Sentence indices discussing this entity
  cleverFallbackIdea: string;       // Bespoke motion graphic alternative if user provides no image
}

export interface EntityAnalysisOutput {
  entities: EntityImageRequirement[];
  overallVisualTheme?: string;
}

/** Standardized, profiled image asset uploaded by the user and stored locally. */
export interface UploadedImageAsset {
  id: string;                       // Matches EntityImageRequirement.id
  entityName: string;               // e.g. "King Baldwin IV"
  originalFilename: string;         // User's original uploaded filename (e.g. "IMG_4920.JPEG")
  standardizedFilename: string;     // Renamed canonical filename (e.g. "king_baldwin.jpeg")
  url: string;                      // Object URL, data URL, or Vite disk serve URL
  mimeType: string;                 // e.g. "image/jpeg"
  width: number;                    // Real pixel width measured in browser
  height: number;                   // Real pixel height measured in browser
  aspectRatio: number;              // width / height
  aspectRatioLabel: string;         // "3:4 portrait" | "16:9 landscape" | "1:1 square" | "custom"
  fileSizeBytes: number;
  uploadedAt: number;
}

export interface AssignedShotAsset {
  assetId: string;
  standardizedFilename: string;
  status: "provided" | "missing_fallback";
  role: "hero_portrait" | "split_evidence" | "dossier_badge" | "token" | "background_atmospheric";
  placement: "center" | "left_half" | "right_half" | "corner_badge";
  width?: number;
  height?: number;
  aspectRatio?: number;
  aspectRatioLabel?: string;
  fallbackVisualMetaphor?: string;  // Explicit vector direction if asset is missing
}

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
  assignedAssets?: AssignedShotAsset[];
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
  assets?: UploadedImageAsset[];
  entityRequirements?: EntityImageRequirement[];
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