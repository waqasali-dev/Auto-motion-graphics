// src/variety/planner.ts
// Plans the variety of a whole film before any frame is drawn.
//
// 1. Archetype search   — depth-first search over intent candidates with hard
//                         constraints (no repeats, family runs, dark budget)
//                         and soft scoring that orders the search.
// 2. Theme pass         — fixed-dark archetypes keep their theme; flexible ones
//                         spend the remaining dark budget.
// 3. Frame pass         — integer, gapless frame boundaries (shot N starts where N-1 ends).
// 4. Audit              — family counts, act coverage, dark share, violations.

import type {
  ActId,
  ArchetypeName,
  Beat,
  Family,
  PlannedShot,
  PlanPolicy,
  ShotMeta,
  ThemeMode,
  Transition,
  VarietyReport,
} from "../sdk/contract";
import {
  ACT_INFO,
  ACT_ORDER,
  ARCHETYPE_META,
  DEFAULT_POLICY,
  FAMILY_INFO,
  INTENT_CANDIDATES,
  actForPosition,
} from "./taxonomy";
/**
 * Edit grammar. A small, fixed set of transitions used in a rhythm, so the cut
 * style is varied but always recognisably the same film.
 */
function pickTransition(i: number, act: ActId, prevAct: ActId | undefined, family: Family, prevFamily: Family | undefined, energy: number): Transition {
  if (i === 0) return "none";
  if (act !== prevAct) return "brandWipe";
  if (energy === 3) return i % 2 === 0 ? "punch" : "whip";
  if (family === prevFamily) return "zoom";
  // Alternate so no single cut style dominates the film.
  return i % 2 === 0 ? "zoom" : "whip";
}

const FAMILIES = Object.keys(FAMILY_INFO) as Family[];
const ALL_ARCHETYPES = Object.keys(ARCHETYPE_META) as ArchetypeName[];
const NODE_BUDGET = 60000;

export function planVariety(beats: Beat[], overrides: Partial<PlanPolicy> = {}): VarietyReport {
  const policy: PlanPolicy = { ...DEFAULT_POLICY, ...overrides };
  const n = beats.length;
  const darkCap = Math.floor(policy.maxDarkShare * n + 1e-9);
  const acts: ActId[] = beats.map((_, i) => actForPosition((i + 0.5) / n));

  const famOf = (a: ArchetypeName): Family => ARCHETYPE_META[a].family;
  const isFixedDark = (a: ArchetypeName) => ARCHETYPE_META[a].fixedMode === "dark";

  const chosen: ArchetypeName[] = [];
  let nodes = 0;

  const runLengthEndingAt = (i: number, f: Family): number => {
    let run = 0;
    for (let k = i - 1; k >= 0 && famOf(chosen[k]) === f; k--) run++;
    return run;
  };

  const allowed = (i: number, a: ArchetypeName, window: number, runMax: number): boolean => {
    if (i > 0 && chosen[i - 1] === a) return false;
    for (let k = Math.max(0, i - window); k < i; k++) if (chosen[k] === a) return false;
    if (runLengthEndingAt(i, famOf(a)) + 1 > runMax) return false;
    if (isFixedDark(a)) {
      const darkSoFar = chosen.filter(isFixedDark).length;
      if (darkSoFar + 1 > darkCap) return false;
    }
    return true;
  };

  const candidateScore = (i: number, a: ArchetypeName): number => {
    const f = famOf(a);
    const past = chosen.slice(0, i);
    const prevFamily = i > 0 ? famOf(past[i - 1]) : undefined;
    const sameFamilySoFar = past.filter((x) => famOf(x) === f).length;
    const cands = INTENT_CANDIDATES[beats[i].intent];
    let s = 0;
    // The dark budget is scarce: spend it on the evidence and close moments, not by default.
    if (isFixedDark(a) && acts[i] !== "evidence" && acts[i] !== "resolve") s -= 3;
    if (prevFamily !== f) s += 4;
    if (!past.includes(a)) s += 3;
    s += Math.max(0, i / FAMILIES.length - sameFamilySoFar) * 2;
    if (ACT_INFO[acts[i]].families.includes(f)) s += 2;
    s += (cands.length - cands.indexOf(a)) * 0.5;
    return s;
  };

  const search = (window: number, runMax: number): boolean => {
    nodes = 0;
    chosen.length = 0;
    const rec = (i: number): boolean => {
      if (i === n) return true;
      if (++nodes > NODE_BUDGET) return false;
      chosen.length = i;
      const cands = INTENT_CANDIDATES[beats[i].intent]
        .filter((a) => allowed(i, a, window, runMax))
        .sort((x, y) => candidateScore(i, y) - candidateScore(i, x));
      for (const a of cands) {
        chosen.push(a);
        if (rec(i + 1)) return true;
        chosen.pop();
      }
      return false;
    };
    return rec(0);
  };

  // Relax the repeat window one shot at a time, and report any relaxation.
  let relaxed = false;
  let solved = false;
  for (let w = policy.repeatWindow; w >= 1 && !solved; w--) {
    solved = search(w, policy.maxFamilyRun);
    if (solved && w < policy.repeatWindow) relaxed = true;
  }
  if (!solved) {
    relaxed = true;
    solved = search(1, n);
  }
  if (!solved) {
    // Deterministic last resort: first candidate that is not a direct repeat.
    chosen.length = 0;
    beats.forEach((b, i) => {
      const cands = INTENT_CANDIDATES[b.intent];
      chosen.push(cands.find((a) => a !== chosen[i - 1]) ?? cands[0]);
    });
  }

  // Theme pass.
  const modes: ThemeMode[] = chosen.map((a) => ARCHETYPE_META[a].fixedMode ?? "light");
  const fixedDark = modes.filter((m) => m === "dark").length;
  let budget = Math.max(0, darkCap - fixedDark);
  const flexible = chosen
    .map((a, i) => (ARCHETYPE_META[a].fixedMode ? -1 : i))
    .filter((i) => i >= 0)
    .sort((x, y) => {
      const px = acts[x] === "evidence" || acts[x] === "resolve" ? 0 : 1;
      const py = acts[y] === "evidence" || acts[y] === "resolve" ? 0 : 1;
      return px - py || x - y;
    });
  for (const i of flexible) {
    if (budget <= 0) break;
    if (modes[i - 1] === "dark" || modes[i + 1] === "dark") continue;
    modes[i] = "dark";
    budget--;
  }

  // Frame pass.
  const durations = beats.map((b) => b.durationFrames);
  const starts = durations.reduce<number[]>((acc, _d, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + durations[i - 1]);
    return acc;
  }, []);
  const totalFrames = durations.reduce((sum, d) => sum + d, 0);

  const spans: ShotMeta["spans"] = [];
  for (const act of ACT_ORDER) {
    const idx = acts.map((a, i) => (a === act ? i : -1)).filter((i) => i >= 0);
    if (idx.length === 0) continue;
    spans.push({
      act,
      label: ACT_INFO[act].label,
      startFrame: starts[idx[0]],
      endFrame: starts[idx[idx.length - 1]] + durations[idx[idx.length - 1]],
    });
  }

  // Shots.
  const shots: PlannedShot[] = beats.map((beat, i) => {
    const archetype = chosen[i];
    const family = famOf(archetype);
    const act = acts[i];
    const mode = modes[i];
    const energy = family === "investigation" ? 3 : ACT_INFO[act].energy;
    const prevFamily = i > 0 ? famOf(chosen[i - 1]) : undefined;
    const lastUse = i > 0 ? chosen.slice(0, i).lastIndexOf(archetype) : -1;
    const transitionIn = pickTransition(i, act, i > 0 ? acts[i - 1] : undefined, family, prevFamily, energy);
    const transitionDir: 1 | -1 = i % 2 === 0 ? 1 : -1;

    const reasons = [
      `intent ${beat.intent} → ${archetype}`,
      prevFamily === undefined
        ? `opens the film in ${family}`
        : prevFamily === family
          ? `family ${family} continues`
          : `family ${family} breaks the previous run`,
      lastUse < 0
        ? `first ${archetype} in this film`
        : `last used ${i - lastUse} shot${i - lastUse === 1 ? "" : "s"} ago`,
      `${mode} theme · ${ARCHETYPE_META[archetype].fixedMode ? "fixed" : "budgeted"}`,
      `act ${ACT_INFO[act].label}${ACT_INFO[act].families.includes(family) ? ` expects ${family}` : ""}`,
      transitionIn === "none" ? "opens on a cut from black" : `enters with ${transitionIn}`,
    ];

    const meta: ShotMeta = {
      index: i,
      total: n,
      startFrame: starts[i],
      totalFrames,
      act,
      actLabel: ACT_INFO[act].label,
      family,
      familyLabel: FAMILY_INFO[family].label,
      energy,
      spans,
    };

    return {
      index: i,
      shotId: `Shot_${String(i + 1).padStart(2, "0")}`,
      intent: beat.intent,
      archetype,
      family,
      act,
      mode,
      energy,
      startFrame: starts[i],
      endFrame: starts[i] + beat.durationFrames,
      durationFrames: beat.durationFrames,
      beat,
      content: { beat },
      meta,
      transitionIn,
      transitionDir,
      reasons,
    };
  });

  // Audit.
  const violations: string[] = [];
  let adjacentRepeats = 0;
  let maxFamilyRun = 0;
  let run = 0;
  let windowBreaches = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0 && chosen[i] === chosen[i - 1]) adjacentRepeats++;
    if (i > 0 && famOf(chosen[i]) === famOf(chosen[i - 1])) run++;
    else run = 1;
    maxFamilyRun = Math.max(maxFamilyRun, run);
    for (let k = Math.max(0, i - policy.repeatWindow); k < i; k++) {
      if (chosen[k] === chosen[i]) {
        windowBreaches++;
        break;
      }
    }
  }
  if (adjacentRepeats > 0) violations.push(`${adjacentRepeats} archetype repeat(s) back to back`);
  if (maxFamilyRun > policy.maxFamilyRun) violations.push(`family run ${maxFamilyRun} exceeds ${policy.maxFamilyRun}`);
  if (windowBreaches > 0) violations.push(`${windowBreaches} archetype(s) repeat inside ${policy.repeatWindow} shots`);

  const darkCount = modes.filter((m) => m === "dark").length;
  if (darkCount > darkCap) violations.push(`dark shots ${darkCount} exceed cap ${darkCap}`);

  const actCoverage = {} as Record<ActId, Family[]>;
  for (const act of ACT_ORDER) {
    const fams = Array.from(new Set(shots.filter((s) => s.act === act).map((s) => s.family)));
    actCoverage[act] = fams;
    if (fams.length > 0 && fams.length < policy.minFamiliesPerAct) {
      violations.push(`act ${ACT_INFO[act].label} uses only ${fams.length} famil${fams.length === 1 ? "y" : "ies"}`);
    }
  }

  const familyCounts = FAMILIES.reduce(
    (acc, f) => ({ ...acc, [f]: shots.filter((s) => s.family === f).length }),
    {} as Record<Family, number>,
  );
  const distinctArchetypes = new Set(chosen).size;
  const distinctFamilies = new Set(chosen.map(famOf)).size;
  const coverage =
    0.5 * (distinctFamilies / FAMILIES.length) + 0.5 * (distinctArchetypes / Math.min(n, ALL_ARCHETYPES.length));
  const varietyScore = Math.max(0, Math.round(100 * coverage - 8 * violations.length));

  return {
    shots,
    totalFrames,
    policy,
    darkCap,
    darkCount,
    darkShare: n === 0 ? 0 : darkCount / n,
    distinctArchetypes,
    distinctFamilies,
    familyCounts,
    maxFamilyRun,
    adjacentRepeats,
    relaxed,
    actCoverage,
    transitionCounts: (["none", "punch", "whip", "zoom", "brandWipe"] as Transition[]).reduce(
      (acc, t) => ({ ...acc, [t]: shots.filter((s) => s.transitionIn === t).length }),
      {} as Record<Transition, number>,
    ),
    violations,
    score: varietyScore,
  };
}
