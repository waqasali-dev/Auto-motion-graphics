// src/variety/taxonomy.ts
// The vocabulary of the variety system: families, acts, intents and the
// archetypes each intent may use. Everything the planner decides is read from here.

import type {
  ActId,
  ArchetypeName,
  Family,
  Intent,
  PlanPolicy,
  ThemeMode,
} from "../sdk/contract";

export const FAMILY_INFO: Record<Family, { label: string; purpose: string; color: string }> = {
  editorial: {
    label: "Editorial",
    purpose: "One idea, one line, one number. Sets the pace.",
    color: "#6C5BE0",
  },
  photo: {
    label: "Photographic",
    purpose: "Real product imagery as evidence of the claim.",
    color: "#C1502E",
  },
  data: {
    label: "Graphs",
    purpose: "Values that draw themselves in step with the voice.",
    color: "#0066FF",
  },
  mesh: {
    label: "Connected",
    purpose: "Nodes, edges and packets. Systems that talk to each other.",
    color: "#0E9F6E",
  },
  investigation: {
    label: "Investigation",
    purpose: "Evidence, search and inspection. The case is built on screen.",
    color: "#D97706",
  },
};

export const ARCHETYPE_META: Record<
  ArchetypeName,
  { family: Family; fixedMode?: ThemeMode; grammar: string }
> = {
  KineticHero: { family: "editorial", fixedMode: "light", grammar: "word slam · capsule expand · rolling digits" },
  ScaleTradeoff: { family: "editorial", fixedMode: "light", grammar: "giant numeral with photo fill · strike and swap" },
  DarkImpactClose: { family: "editorial", fixedMode: "dark", grammar: "tracking-expand statement · logo end card" },
  SplitComparison: { family: "photo", fixedMode: "dark", grammar: "seam draw · photo wipes · strike-through" },
  DeviceMockup: { family: "photo", fixedMode: "dark", grammar: "3D product carousel · camera dolly" },
  PerspectiveDataGrid: { family: "data", fixedMode: "dark", grammar: "flying perspective floor · counter · lit dots" },
  BentoBadgeCluster: { family: "data", fixedMode: "light", grammar: "full-frame block wipes · type grid" },
  ChartStory: { family: "data", grammar: "pen-drawn line · camera rides the data" },
  BarComparison: { family: "data", grammar: "bars grow · winner isolated · stat slam" },
  RadialHub: { family: "mesh", fixedMode: "light", grammar: "trim-path rings · orbiting labels · pull back" },
  NetworkMesh: { family: "mesh", grammar: "tight on planner · pull back · light packets" },
  InvestigationBoard: { family: "investigation", fixedMode: "dark", grammar: "camera travels evidence · string · stamp slam" },
  MagnifierInspect: { family: "investigation", grammar: "word stream pan · lens lock · glitch fix" },
  QueryTrace: { family: "investigation", grammar: "giant typed query · results fly in" },
};

/** Which archetypes can render each intent. Ordered by preference. */
// Candidates are chosen so every archetype can render the content its intent
// carries. A beat with a search query only ever lands on a search layout, and so on.
export const INTENT_CANDIDATES: Record<Intent, ArchetypeName[]> = {
  hook: ["KineticHero"],
  trend: ["ChartStory", "ScaleTradeoff", "PerspectiveDataGrid"],
  evidence: ["InvestigationBoard"],
  search: ["QueryTrace", "KineticHero"],
  inspect: ["MagnifierInspect"],
  system: ["NetworkMesh", "RadialHub"],
  compare: ["BarComparison", "ChartStory"],
  contrast: ["SplitComparison", "ScaleTradeoff"],
  proof: ["DeviceMockup", "BentoBadgeCluster"],
  summary: ["BentoBadgeCluster", "PerspectiveDataGrid", "ChartStory", "KineticHero", "ScaleTradeoff"],
  trace: ["NetworkMesh", "RadialHub"],
  stat: ["ScaleTradeoff", "KineticHero", "BentoBadgeCluster"],
  close: ["DarkImpactClose", "KineticHero"],
};

export const ACT_ORDER: ActId[] = ["hook", "evidence", "proof", "resolve"];

export const ACT_INFO: Record<
  ActId,
  { label: string; roman: string; goal: string; energy: 1 | 2 | 3; families: Family[] }
> = {
  hook: {
    label: "Hook",
    roman: "I",
    goal: "State the stakes in one line.",
    energy: 1,
    families: ["editorial", "data"],
  },
  evidence: {
    label: "Evidence",
    roman: "II",
    goal: "Open the case: evidence, search, inspection.",
    energy: 3,
    families: ["investigation", "mesh"],
  },
  proof: {
    label: "Proof",
    roman: "III",
    goal: "Show the numbers and the product.",
    energy: 2,
    families: ["data", "photo"],
  },
  resolve: {
    label: "Resolve",
    roman: "IV",
    goal: "Summarise and land the close.",
    energy: 1,
    families: ["editorial", "data"],
  },
};

/** Maps a normalised position in the film (0..1) to an act. */
export function actForPosition(p: number): ActId {
  if (p < 0.15) return "hook";
  if (p < 0.45) return "evidence";
  if (p < 0.8) return "proof";
  return "resolve";
}

export const DEFAULT_POLICY: PlanPolicy = {
  maxDarkShare: 0.15,
  maxFamilyRun: 2,
  repeatWindow: 4,
  minFamiliesPerAct: 2,
};
