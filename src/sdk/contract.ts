// /src/sdk/contract.ts
// Shared types for the variety system: families, acts, intents, beats, shot
// metadata, the plan report, and the scene props every archetype accepts.

export type ThemeMode = "light" | "dark";

/** How a shot enters. Transitions happen between shots, never as per-shot fades. */
export type Transition = "none" | "punch" | "whip" | "zoom" | "brandWipe";

export type Family = "editorial" | "photo" | "data" | "mesh" | "investigation";

export type ActId = "hook" | "evidence" | "proof" | "resolve";

export type Intent =
  | "hook"
  | "trend"
  | "evidence"
  | "trace"
  | "inspect"
  | "compare"
  | "proof"
  | "system"
  | "stat"
  | "summary"
  | "close"
  | "search"
  | "contrast";

export type Energy = 1 | 2 | 3;

export type ArchetypeName =
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

/**
 * A beat is the copy and data for one shot. The planner chooses the archetype;
 * the beat does not know which layout will render it.
 */
export interface Beat {
  intent: Intent;
  headline: string;
  accentWord?: string;
  kicker?: string;
  figures?: { value: string; label: string }[];
  series?: number[];
  seriesLabels?: string[];
  bars?: { label: string; value: number }[];
  nodes?: string[];
  evidence?: { tag: string; title: string; note: string }[];
  query?: string;
  results?: { title: string; source: string; score: number }[];
  rows?: { cells: string[]; flag?: boolean; fix?: string }[];
  image?: string;
  spoken?: string;
  durationFrames: number;
}

/** What a scene receives. Scenes read the beat directly. */
export interface SceneContent {
  beat?: Beat;
}

/** Where a shot sits in the film. */
export interface ShotMeta {
  index: number;
  total: number;
  startFrame: number;
  totalFrames: number;
  act: ActId;
  actLabel: string;
  family: Family;
  familyLabel: string;
  energy: Energy;
  spans: { act: ActId; label: string; startFrame: number; endFrame: number }[];
}

export interface SceneProps {
  frame: number;
  duration: number;
  mode?: ThemeMode;
  content?: SceneContent;
  energy?: Energy;
}

export interface PlanPolicy {
  maxDarkShare: number;
  maxFamilyRun: number;
  repeatWindow: number;
  minFamiliesPerAct: number;
}

export interface PlannedShot {
  index: number;
  shotId: string;
  intent: Intent;
  archetype: ArchetypeName;
  family: Family;
  act: ActId;
  mode: ThemeMode;
  energy: Energy;
  startFrame: number;
  endFrame: number;
  durationFrames: number;
  beat: Beat;
  content: SceneContent;
  meta: ShotMeta;
  transitionIn: Transition;
  transitionDir: 1 | -1;
  reasons: string[];
}

export interface VarietyReport {
  shots: PlannedShot[];
  totalFrames: number;
  policy: PlanPolicy;
  darkCap: number;
  darkCount: number;
  darkShare: number;
  distinctArchetypes: number;
  distinctFamilies: number;
  familyCounts: Record<Family, number>;
  maxFamilyRun: number;
  adjacentRepeats: number;
  relaxed: boolean;
  actCoverage: Record<ActId, Family[]>;
  transitionCounts: Record<Transition, number>;
  violations: string[];
  score: number;
}
