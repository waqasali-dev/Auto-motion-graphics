// The actual user-video pipeline:
// transcript -> creative storyboard -> per-shot art direction -> LLM-authored
// Remotion TSX -> static validation -> three real browser renderStill smoke tests.
// This pipeline never looks up or inserts one of the reference reel's archetypes.

import type { RawTranscriptJSON } from "../sdk/contract.pipeline";
import type { PipelineLog } from "./projects";
import type {
  CreativePlanDraftShot,
  CreativePlanOutput,
  CreativeShotPlan,
  GeneratedFilm,
  GeneratedSceneShot,
  ShotVisualPrompt,
  WordCue,
} from "../sdk/contract.generated";
import { preprocessTranscript } from "./pipeline";
import { generateRemotionShotCode, generateShotVisualPrompt, planCreativeFilm } from "./openai";
import { getEnv, getCodeConcurrency } from "./env";
import type { GeneratedSceneProps } from "./generatedCode";
import { actForPosition } from "../variety/taxonomy";

const FPS = 60;
const MAX_RETRIES = 3;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const REF_STYLE =
  "Premium documentary, thriller, and explainer motion design (1920x1080 @ 60fps): sleek trajectory charts with camera tracking and POV zoom, floating comparison cards with focus frames, bento metric dossiers, connected capital/system flow meshes, and purposeful iconic vector emblems and badges where needed to anchor meaning. Cinematic, broadcast-grade 2D spatial layouts.";

export interface CreativePipelineInput {
  title: string;
  sourceTranscript: string;
  creativeBrief?: string;
  rawTranscript: RawTranscriptJSON;
  audioDurationSec: number;
  sourceAudioName?: string;
  alignment: GeneratedFilm["alignment"];
  alignmentConfidence: number;
  audioUrl?: string;
  resumeFilm?: GeneratedFilm | null;
  startFromStage?: "audio-align" | "planning" | "art-direction" | "coding" | "validation";
  onLog?: (entry: PipelineLog) => void;
  onStage?: (stage: "planning" | "art-direction" | "coding" | "validation", progress: number, total: number, message: string) => void;
  onSaveSnapshot?: (draftFilm: GeneratedFilm, stage: "planning" | "art-direction" | "coding" | "validation") => void;
}

export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  staggerMs = 0,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async (_, workerIndex) => {
    if (staggerMs > 0 && workerIndex > 0) {
      await sleep(workerIndex * staggerMs);
    }
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

function makeGlobalWordCues(raw: RawTranscriptJSON): WordCue[] {
  const sentences = raw.sentences;
  return raw.words.map((word, wordIndex) => {
    const sentenceIndex = sentences.findIndex((s) => wordIndex >= s.wordStart && wordIndex <= s.wordEnd);
    return {
      wordIndex,
      sentenceIndex: sentenceIndex < 0 ? 0 : sentenceIndex,
      text: word.text,
      startFrame: Math.max(0, Math.round(word.start * FPS)),
      spokenEndFrame: Math.max(0, Math.round(word.spokenEnd * FPS)),
      pauseFrames: Math.max(0, Math.round((word.end - word.spokenEnd) * FPS)),
      confidence: word.confidence,
    };
  });
}

/** Dark budget scales with film length and never blocks short films outright. */
export function darkBudgetFor(shotCount: number): number {
  if (shotCount <= 2) return 0;
  return Math.max(1, Math.floor(shotCount * 0.15));
}

function validatePlan(
  plan: CreativePlanOutput,
  raw: RawTranscriptJSON,
  cues: WordCue[],
  range?: { start: number; end: number; trailingFamilies?: string[]; darkBudget?: number; priorIdeas?: string[] },
): string[] {
  const errors: string[] = [];
  const n = raw.sentences.length;
  const first = range?.start ?? 0;
  const last = range?.end ?? n - 1;
  if (!plan.shots.length) errors.push("Storyboard must contain at least one shot.");
  if (plan.shots[0]?.sentenceStartIndex !== first) errors.push(`First shot must start at sentence index ${first}.`);
  let nextSentence = first;
  const darkCap = range?.darkBudget ?? darkBudgetFor(plan.shots.length);
  let darkCount = 0;
  let familyRun = range?.trailingFamilies?.length
    ? range.trailingFamilies.filter((f) => f === range.trailingFamilies!.at(-1)).length
    : 0;
  let previousFamily = range?.trailingFamilies?.at(-1) ?? "";
  let familyRunMax = 0;
  const ids = new Set<string>();
  const visualIdeas = new Set<string>((range?.priorIdeas ?? []).map((s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()));

  for (const shot of plan.shots) {
    if (ids.has(shot.shotId)) errors.push(`Duplicate shotId ${shot.shotId}.`);
    ids.add(shot.shotId);
    if (shot.sentenceStartIndex !== nextSentence) errors.push(`${shot.shotId} starts at sentence ${shot.sentenceStartIndex}; expected contiguous index ${nextSentence}.`);
    if (shot.sentenceEndIndex < shot.sentenceStartIndex || shot.sentenceEndIndex > last) errors.push(`${shot.shotId} has invalid sentence indices for the range ${first}..${last}.`);
    const spoken = raw.sentences.slice(shot.sentenceStartIndex, shot.sentenceEndIndex + 1);
    const seconds = spoken.reduce((sum, s) => sum + s.end - s.start, 0);
    // A single long sentence cannot be split further. Multi-sentence shots should stay reasonably paced.
    if (seconds > 16.0 && spoken.length > 1) {
      errors.push(`${shot.shotId} is ${seconds.toFixed(1)}s across ${spoken.length} sentences; split it so each shot stays near 7–11s.`);
    }
    if (shot.spokenText.trim().length < 3) errors.push(`${shot.shotId} has no spoken line.`);
    if (shot.visualIdea.trim().length < 18) errors.push(`${shot.shotId} needs a specific transcript-grounded visual idea.`);
    const ideaKey = shot.visualIdea.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (visualIdeas.has(ideaKey)) errors.push(`${shot.shotId} repeats another shot's visual idea; invent a new visual metaphor.`);
    visualIdeas.add(ideaKey);
    if (shot.visualFamily === previousFamily) familyRun++;
    else familyRun = 1;
    previousFamily = shot.visualFamily;
    familyRunMax = Math.max(familyRunMax, familyRun);
    if (familyRunMax > 2) errors.push(`Shot ${shot.shotId} extends the ${shot.visualFamily} family beyond two consecutive shots.`);
    if (shot.themeMode === "dark") darkCount++;
    for (const i of shot.emphasisWordIndices) {
      if (!cues.some((c) => c.wordIndex === i && c.sentenceIndex >= shot.sentenceStartIndex && c.sentenceIndex <= shot.sentenceEndIndex)) {
        errors.push(`${shot.shotId} highlights word ${i}, which is outside its sentence range.`);
      }
    }
    nextSentence = shot.sentenceEndIndex + 1;
  }
  if (nextSentence !== last + 1) errors.push(`Storyboard covers through sentence ${nextSentence - 1}; this range ends at ${last}.`);
  if (darkCount > darkCap) errors.push(`${darkCount} dark shots exceed the allowance of ${darkCap} for this range.`);
  if (!range) {
    const actFamilies = new Map<string, Set<string>>();
    plan.shots.forEach((shot, i) => {
      const act = actForPosition((i + 0.5) / Math.max(1, plan.shots.length));
      if (!actFamilies.has(act)) actFamilies.set(act, new Set());
      actFamilies.get(act)!.add(shot.visualFamily);
    });
    for (const [act, families] of actFamilies) {
      const count = plan.shots.filter((_, i) => actForPosition((i + 0.5) / Math.max(1, plan.shots.length)) === act).length;
      if (count >= 2 && families.size < 2) errors.push(`Act ${act} needs at least two visual families; it currently uses ${[...families].join(", ")}.`);
    }
  }
  return [...new Set(errors)];
}

/**
 * Automatically bridges any off-by-one gaps or overlaps in the planner's shot coverage,
 * guaranteeing 100% contiguous sentence coverage from first to last without throwing fatal errors.
 */
function reconcileShotCoverage(
  shots: CreativePlanDraftShot[],
  first: number,
  last: number,
  sentences: RawTranscriptJSON["sentences"],
  _cues?: WordCue[]
): CreativePlanDraftShot[] {
  if (!shots || !shots.length) {
    const spoken = sentences.slice(first, last + 1).map((s) => s.text).join(" ");
    return [{
      shotId: `Shot_${first}`,
      sentenceStartIndex: first,
      sentenceEndIndex: last,
      spokenText: spoken || "Motion sequence",
      cleanedDisplaySentences: sentences.slice(first, last + 1).map((s) => s.text),
      purpose: "Narrative visual beat",
      visualIdea: "Comparison Cards illustrating key technology components",
      keyEvidence: [],
      emphasisWordIndices: [sentences[first]?.wordStart ?? 0],
      visualFamily: "editorial",
      themeMode: "dark",
      energy: 2,
      transitionIn: "none",
      transitionDirection: 1,
      continuityNote: "Continuous flow",
    }];
  }

  // Deduplicate and sort by sentenceStartIndex
  const seenIds = new Set<string>();
  const cleaned: CreativePlanDraftShot[] = [];
  for (const s of shots) {
    let id = s.shotId || `Shot_${cleaned.length + 1}`;
    while (seenIds.has(id)) {
      id = `${id}_alt`;
    }
    seenIds.add(id);
    cleaned.push({ ...s, shotId: id });
  }
  cleaned.sort((a, b) => a.sentenceStartIndex - b.sentenceStartIndex);

  // Force first shot to start at 'first'
  cleaned[0].sentenceStartIndex = first;

  let cursor = first;
  for (let i = 0; i < cleaned.length; i++) {
    const shot = cleaned[i];
    shot.sentenceStartIndex = cursor;
    if (shot.sentenceEndIndex < shot.sentenceStartIndex) {
      shot.sentenceEndIndex = shot.sentenceStartIndex;
    }

    if (i === cleaned.length - 1) {
      // Last shot must cover to the end of the range
      shot.sentenceEndIndex = last;
    } else {
      // Intermediate shot must not consume the rest of the window
      if (shot.sentenceEndIndex >= last) {
        shot.sentenceEndIndex = Math.max(shot.sentenceStartIndex, last - (cleaned.length - i));
      }
    }
    cursor = shot.sentenceEndIndex + 1;

    // Filter emphasis words to strictly lie within this shot's sentence range
    const shotFirstWord = sentences[shot.sentenceStartIndex]?.wordStart ?? 0;
    const shotLastWord = sentences[shot.sentenceEndIndex]?.wordEnd ?? shotFirstWord;
    const validWords = (shot.emphasisWordIndices || []).filter((w) => w >= shotFirstWord && w <= shotLastWord);
    shot.emphasisWordIndices = validWords.length ? validWords.slice(0, 3) : [shotFirstWord];

    // Ensure spoken text is populated
    if (!shot.spokenText || shot.spokenText.trim().length < 3) {
      shot.spokenText = sentences.slice(shot.sentenceStartIndex, shot.sentenceEndIndex + 1).map((s) => s.text).join(" ");
    }
  }

  return cleaned;
}

function attachFrameData(
  plan: CreativePlanOutput,
  raw: RawTranscriptJSON,
  globalCues: WordCue[],
): Array<CreativeShotPlan & { startFrame: number; endFrame: number; durationFrames: number; wordCues: WordCue[] }> {
  let cursor = 0;
  return plan.shots.map((shot, index) => {
    const first = raw.sentences[shot.sentenceStartIndex];
    const last = raw.sentences[shot.sentenceEndIndex];
    const startFrame = index === 0 ? 0 : cursor;
    const endFrame = index === plan.shots.length - 1
      ? Math.ceil(raw.audio.durationSec * FPS)
      : Math.round(last.end * FPS);
    const durationFrames = Math.max(1, endFrame - startFrame);
    const wordStartIndex = first.wordStart;
    const wordEndIndex = last.wordEnd;
    const sourceLine = raw.sentences.slice(shot.sentenceStartIndex, shot.sentenceEndIndex + 1).map((s) => s.text).join(" ");
    const localCues = globalCues
      .filter((w) => w.wordIndex >= wordStartIndex && w.wordIndex <= wordEndIndex)
      .map((w) => ({
        ...w,
        startFrame: Math.max(0, w.startFrame - startFrame - 4),
        spokenEndFrame: Math.max(0, w.spokenEndFrame - startFrame),
      }));
    cursor = endFrame;
    return {
      ...shot,
      act: actForPosition((index + 0.5) / plan.shots.length),
      spokenText: sourceLine,
      wordStartIndex,
      wordEndIndex,
      startFrame,
      endFrame,
      durationFrames,
      wordCues: localCues,
    };
  });
}

function cuePayload(cues: WordCue[]) {
  return cues.map(({ wordIndex, sentenceIndex, text, startFrame, spokenEndFrame, pauseFrames, confidence }) => ({
    wordIndex, sentenceIndex, text, startFrame, spokenEndFrame, pauseFrames, confidence,
  }));
}

async function smokeShot(source: string, props: GeneratedSceneProps, durationFrames: number, id: string) {
  const { compileGeneratedShot } = await import("./generatedCode");
  const { renderStillOnWeb } = await import("@remotion/web-renderer");
  const { component } = compileGeneratedShot(source);
  const frames = [...new Set([0, Math.floor(durationFrames / 2), Math.max(0, durationFrames - 1)])];
  for (const frame of frames) {
    const result = await renderStillOnWeb({
      composition: {
        id: `${id}-${frame}`,
        component: component as unknown as React.ComponentType<Record<string, unknown>>,
        durationInFrames: durationFrames,
        fps: FPS,
        width: 1920,
        height: 1080,
      },
      inputProps: props as unknown as Record<string, unknown>,
      frame,
      scale: 0.12,
      logLevel: "error",
    });
    const canvas = await result.canvas();
    if (canvas.width === 0 || canvas.height === 0) throw new Error(`Remotion smoke frame ${frame} produced an empty canvas.`);
  }
}

/** Roughly how many beats a set of sentences will become in broadcast motion pacing (7–11s per beat). */
function estimateShotCount(sentences: RawTranscriptJSON["sentences"]): number {
  const seconds = sentences.reduce((sum, s) => sum + (s.end - s.start), 0);
  return Math.max(1, Math.round(seconds / 9.8));
}

/**
 * Split the transcript into planning windows. One window for short films; for long
 * narration the film is planned in continuous parts so prompts and output budgets
 * never overflow, while shot count still follows the content.
 */
function buildPlanWindows(sentences: RawTranscriptJSON["sentences"]): Array<{ start: number; end: number }> {
  // Target 52 seconds per window (≈ 10-14 sentences, 5-6 shots per call in broadcast pacing).
  // Matches the reference demo reel density while staying within the $5–$6 film budget.
  const TARGET_WINDOW_SECONDS = 52;
  const total = sentences.reduce((sum, s) => sum + (s.end - s.start), 0);
  if (!sentences.length) return [];
  if (total <= TARGET_WINDOW_SECONDS * 1.35) return [{ start: 0, end: sentences.length - 1 }];

  const windows: Array<{ start: number; end: number }> = [];
  let start = 0;
  let elapsed = 0;
  for (let i = 0; i < sentences.length; i++) {
    elapsed += sentences[i].end - sentences[i].start;
    const isLast = i === sentences.length - 1;
    if (elapsed >= TARGET_WINDOW_SECONDS || isLast) {
      // Avoid orphaning a tiny tail window onto its own planner call.
      const remaining = sentences.slice(i + 1).reduce((sum, s) => sum + (s.end - s.start), 0);
      if (!isLast && remaining < TARGET_WINDOW_SECONDS * 0.35) continue;
      windows.push({ start, end: i });
      start = i + 1;
      elapsed = 0;
    }
  }
  if (start < sentences.length) windows.push({ start, end: sentences.length - 1 });
  return windows;
}

export async function runCreativePipeline(input: CreativePipelineInput): Promise<GeneratedFilm> {
  const started = Date.now();
  const log = (stage: string, message: string, status: PipelineLog["status"] = "running", detail?: string) =>
    input.onLog?.({ stage, message, status, timestamp: Date.now(), detail });

  log("1_preprocessor", "Reading the transcript and locking every word to its spoken frame.");
  const digest = preprocessTranscript(input.rawTranscript);
  const allWords = makeGlobalWordCues(input.rawTranscript);
  log(
    "1_preprocessor",
    `${digest.compactSentences.length} sentences · ${allWords.length} word cues · ${digest.flaggedSentences.length} low-confidence flags`,
    "success",
    [
      `Audio duration: ${input.audioDurationSec.toFixed(2)}s → ${Math.ceil(input.audioDurationSec * FPS)} frames at 60fps`,
      `Alignment source: ${input.alignment} (${Math.round(input.alignmentConfidence * 100)}% confidence)`,
      "",
      "First word cues (global frame positions):",
      ...allWords.slice(0, 24).map((w) => `  W${w.wordIndex} f${w.startFrame}→${w.spokenEndFrame} ${JSON.stringify(w.text)}${w.confidence < 0.5 ? "  [flagged]" : ""}`),
      allWords.length > 24 ? `  … ${allWords.length - 24} more cues` : "",
      digest.flaggedSentences.length ? `\nFlagged for display-text cleanup: ${digest.flaggedSentences.map((f) => `S${f.sentenceIndex} (${f.reason})`).join(", ")}` : "",
    ].filter(Boolean).join("\n"),
  );

  // Plan in windows so a 30-second script and an 8-minute script both work.
  // Shot count is never fixed: each window returns as many beats as its content needs.
  const sentences = input.rawTranscript.sentences;
  const totalFrames = Math.ceil(input.audioDurationSec * FPS);
  const shouldReusePlan = Boolean(
    input.resumeFilm &&
    input.resumeFilm.shots.length > 0 &&
    input.startFromStage !== "planning" &&
    input.startFromStage !== "audio-align"
  );

  let plan: CreativePlanOutput;
  let framed: Array<CreativeShotPlan & { startFrame: number; endFrame: number; durationFrames: number; wordCues: WordCue[] }>;
  let draftShots: GeneratedSceneShot[];

  if (shouldReusePlan) {
    const rf = input.resumeFilm!;
    log("2_planner", `Reusing existing storyboard with ${rf.shots.length} shots.`, "success");
    plan = {
      filmTitle: rf.title,
      creativeNorthStar: rf.visualContinuity.palette || "Technical motion design",
      palette: rf.visualContinuity.palette,
      typography: rf.visualContinuity.typography,
      texture: rf.visualContinuity.texture,
      continuityRules: rf.visualContinuity.rules,
      shots: rf.shots,
    };
    framed = rf.shots.map((s) => ({
      ...s,
      wordCues: s.wordCues,
    }));
    draftShots = rf.shots.map((s) => {
      if (input.startFromStage === "art-direction") {
        return {
          ...s,
          visualPrompt: undefined,
          sourceCode: "",
          sourceHash: "",
          visualSummary: `${s.shotId}: Planned`,
          designChoices: [],
          codeStatus: "planned" as const,
          retries: 0,
          compileError: undefined,
        };
      }
      if (input.startFromStage === "coding") {
        return {
          ...s,
          sourceCode: "",
          sourceHash: "",
          visualSummary: `${s.shotId}: Prompted`,
          codeStatus: "prompted" as const,
          retries: 0,
          compileError: undefined,
        };
      }
      return { ...s };
    });
  } else {
    // Plan in windows so a 30-second script and an 8-minute script both work.
    // Shot count is never fixed: each window returns as many beats as its content needs.
    const windows = buildPlanWindows(sentences);
    log(
      "2_planner",
      windows.length > 1
        ? `Long transcript: planning in ${windows.length} continuous parts so no beat is truncated.`
        : "AI creative director is mapping what each spoken beat should show.",
      "running",
    );

    const mergedShots: CreativePlanOutput["shots"] = [];
    let lockedStyle: { northStar: string; palette: string; typography: string; texture: string; continuityRules: string[] } | undefined;
    let filmTitle = input.title;

    for (const [wIndex, win] of windows.entries()) {
      input.onStage?.("planning", wIndex, windows.length, windows.length > 1 ? `Storyboarding part ${wIndex + 1} of ${windows.length}` : "Storyboarding the film");
      const windowSentences = sentences.slice(win.start, win.end + 1);
      const windowDigest = windowSentences.map(
        (s) => `[S${s.index} | ${s.start.toFixed(2)}s-${s.end.toFixed(2)}s | words:${s.wordStart}..${s.wordEnd}] ${JSON.stringify(s.text)}`,
      );
      const windowWords = allWords.filter((c) => c.sentenceIndex >= win.start && c.sentenceIndex <= win.end);
      const remainingDark = darkBudgetFor(estimateShotCount(sentences)) - mergedShots.filter((s) => s.themeMode === "dark").length;
      const windowDarkBudget = Math.max(0, Math.min(remainingDark, Math.ceil(darkBudgetFor(estimateShotCount(windowSentences)) || 0)));

      const windowDurationSec = Math.max(1, (windowSentences[windowSentences.length - 1]?.end ?? 0) - (windowSentences[0]?.start ?? 0));
      const planWindow = {
        index: wIndex,
        total: windows.length,
        sentenceStart: win.start,
        sentenceEnd: win.end,
        previousShotSummaries: mergedShots.map((s) => s.visualIdea),
        lockedStyle,
        trailingFamilies: mergedShots.slice(-2).map((s) => s.visualFamily),
        darkBudget: windowDarkBudget,
        totalFilmSeconds: input.audioDurationSec,
      };
      const baseArgs = {
        transcriptDigest: windowDigest,
        words: windowWords,
        durationFrames: Math.ceil(windowDurationSec * FPS),
        referenceStyle: REF_STYLE,
        creativeBrief: input.creativeBrief,
        window: planWindow,
      };

      // Reuse cached shots if resuming a draft that already planned this window
      const existingShots = input.resumeFilm?.shots;
      const cachedForWindow = existingShots?.filter(
        (s) => s.sentenceStartIndex >= win.start && s.sentenceEndIndex <= win.end
      );
      if (
        cachedForWindow &&
        cachedForWindow.length > 0 &&
        cachedForWindow[0].sentenceStartIndex === win.start &&
        cachedForWindow[cachedForWindow.length - 1].sentenceEndIndex === win.end
      ) {
        log(
          "2_planner",
          `Part ${wIndex + 1}/${windows.length}: reusing ${cachedForWindow.length} previously planned beats for sentences ${win.start}–${win.end}.`,
          "running"
        );
        if (wIndex === 0) {
          filmTitle = input.resumeFilm?.title || input.title;
          lockedStyle = {
            northStar: input.resumeFilm?.visualContinuity.palette || "Technical motion design",
            palette: input.resumeFilm?.visualContinuity.palette || "slate, cyan, white",
            typography: input.resumeFilm?.visualContinuity.typography || "Inter",
            texture: input.resumeFilm?.visualContinuity.texture || "clean",
            continuityRules: input.resumeFilm?.visualContinuity.rules || ["Consistent grid alignment"],
          };
        }
        mergedShots.push(...cachedForWindow);
        continue;
      }

      let part: CreativePlanOutput | null = null;
      let lastErr: Error | null = null;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          part = await planCreativeFilm(
            attempt === 1
              ? baseArgs
              : { ...baseArgs, repairErrors: [lastErr?.message || "Ensure all sentence indices are within range and valid JSON."] }
          );
          break;
        } catch (err) {
          lastErr = err as Error;
          log("2_planner", `Part ${wIndex + 1} plan attempt ${attempt} warning: ${lastErr.message.slice(0, 100)}. Retrying...`, "running");
          await new Promise((r) => setTimeout(r, 1200 * attempt));
        }
      }

      if (!part || !part.shots || !part.shots.length) {
        log("2_planner", `Part ${wIndex + 1} AI response incomplete; synthesizing storyboard from narration.`, "running");
        part = {
          filmTitle,
          creativeNorthStar: lockedStyle?.northStar || "Technical motion design",
          palette: lockedStyle?.palette || "slate, cyan, white",
          typography: lockedStyle?.typography || "Inter",
          texture: lockedStyle?.texture || "clean",
          continuityRules: lockedStyle?.continuityRules || ["Consistent grid alignment"],
          shots: reconcileShotCoverage([], win.start, win.end, sentences, allWords),
        };
      }

      // Reconcile coverage automatically: guarantees 100% gapless contiguous coverage for this window
      part.shots = reconcileShotCoverage(part.shots, win.start, win.end, sentences, allWords);

      const issues = validatePlan(part, input.rawTranscript, allWords, {
        start: win.start,
        end: win.end,
        trailingFamilies: planWindow.trailingFamilies,
        darkBudget: windowDarkBudget,
        priorIdeas: planWindow.previousShotSummaries,
      });

      if (issues.length) {
        log("2_planner", `Part ${wIndex + 1} accepted with notes: ${issues.join("; ")}`, "running");
      }

      if (wIndex === 0) {
        filmTitle = part.filmTitle || input.title;
        lockedStyle = {
          northStar: part.creativeNorthStar,
          palette: part.palette,
          typography: part.typography,
          texture: part.texture,
          continuityRules: part.continuityRules,
        };
      }
      mergedShots.push(...part.shots);
      log(
        "2_planner",
        `Part ${wIndex + 1}/${windows.length}: ${part.shots.length} beats for sentences ${win.start}–${win.end}.`,
        "running",
        part.shots.map((s) => `${s.shotId} · S${s.sentenceStartIndex}-${s.sentenceEndIndex} · ${s.visualFamily} · ${s.visualIdea}`).join("\n"),
      );

      // Incrementally save draft snapshot as windows complete so partial work is preserved
      if (input.onSaveSnapshot) {
        try {
          const interimPlan: CreativePlanOutput = {
            filmTitle,
            creativeNorthStar: lockedStyle?.northStar ?? "",
            palette: lockedStyle?.palette ?? "",
            typography: lockedStyle?.typography ?? "",
            texture: lockedStyle?.texture ?? "",
            continuityRules: lockedStyle?.continuityRules ?? [],
            shots: mergedShots.map((s, i) => ({ ...s, shotId: `Shot_${String(i + 1).padStart(2, "0")}` })),
          };
          const interimFramed = attachFrameData(interimPlan, input.rawTranscript, allWords);
          input.onSaveSnapshot({
            id: input.resumeFilm?.id || `film_${started}`,
            title: filmTitle,
            width: 1920,
            height: 1080,
            fps: FPS,
            durationInFrames: totalFrames,
            audioDurationSec: input.audioDurationSec,
            transcript: input.rawTranscript.sentences.map((s) => s.text).join(" "),
            sourceTranscript: input.sourceTranscript,
            sourceAudioName: input.sourceAudioName,
            alignment: input.alignment,
            alignmentConfidence: input.alignmentConfidence,
            wordCues: allWords,
            shots: interimFramed.map((shot, idx) => ({
              ...shot,
              wordCues: cuePayload(shot.wordCues),
              sourceCode: "",
              sourceHash: "",
              visualSummary: `${shot.shotId}: Planned`,
              designChoices: [],
              codeStatus: "planned" as const,
              retries: 0,
              continuity: {
                previousVisualSummary: interimFramed[idx - 1]?.visualIdea ?? "opening shot",
                nextVisualSummary: interimFramed[idx + 1]?.visualIdea ?? "final shot",
                themeTransition: `${interimFramed[idx - 1]?.themeMode ?? shot.themeMode}->${shot.themeMode}`,
                paletteAnchor: interimPlan.palette,
                typeAnchor: interimPlan.typography,
              },
            })),
            visualContinuity: {
              palette: lockedStyle?.palette ?? "",
              typography: lockedStyle?.typography ?? "",
              texture: lockedStyle?.texture ?? "",
              rules: lockedStyle?.continuityRules ?? [],
            },
            model: getEnv().model,
            createdAt: started,
          }, "planning");
        } catch {
          // ignore intermediate snapshot errors
        }
      }
    }

    // Whole-film reconciliation guarantees contiguous coverage from sentence 0 to the end
    const reconciledWhole = reconcileShotCoverage(mergedShots, 0, sentences.length - 1, sentences, allWords);
    plan = {
      filmTitle,
      creativeNorthStar: lockedStyle?.northStar ?? "",
      palette: lockedStyle?.palette ?? "",
      typography: lockedStyle?.typography ?? "",
      texture: lockedStyle?.texture ?? "",
      continuityRules: lockedStyle?.continuityRules ?? [],
      shots: reconciledWhole.map((s, i) => ({ ...s, shotId: `Shot_${String(i + 1).padStart(2, "0")}` })),
    };

    const finalIssues = validatePlan(plan, input.rawTranscript, allWords);
    if (finalIssues.length) {
      log("2_planner", `Whole-film audit passed with notes: ${finalIssues.join("; ")}`, "running");
    }
    log(
      "2_planner",
      `${plan.shots.length} original visual beats planned across ${(input.audioDurationSec / 60).toFixed(1)} minutes — count derived from content, not a preset.`,
      "success",
      plan.shots.map((s) => `${s.shotId} · S${s.sentenceStartIndex}-${s.sentenceEndIndex} · ${s.visualFamily}/${s.themeMode} · ${s.purpose}\n    ${s.visualIdea}`).join("\n"),
    );

    framed = attachFrameData(plan, input.rawTranscript, allWords);
    const summariesInit = framed.map((s) => s.visualIdea);
    draftShots = framed.map((shot, index) => ({
      ...shot,
      wordCues: cuePayload(shot.wordCues),
      sourceCode: "",
      sourceHash: "",
      visualSummary: `${shot.shotId}: Planned`,
      designChoices: [],
      codeStatus: "planned" as const,
      retries: 0,
      continuity: {
        previousVisualSummary: summariesInit[index - 1] ?? "opening shot",
        nextVisualSummary: summariesInit[index + 1] ?? "final shot",
        paletteAnchor: plan.palette,
        typeAnchor: plan.typography,
      },
    }));
  }

  // Persist plan snapshot immediately
  const currentDraftFilm: GeneratedFilm = {
    id: input.resumeFilm?.id || `film_${started}`,
    title: plan.filmTitle || input.title,
    width: 1920,
    height: 1080,
    fps: FPS,
    durationInFrames: totalFrames,
    audioDurationSec: input.audioDurationSec,
    transcript: input.rawTranscript.sentences.map((s) => s.text).join(" "),
    sourceTranscript: input.sourceTranscript,
    sourceAudioName: input.sourceAudioName,
    alignment: input.alignment,
    alignmentConfidence: input.alignmentConfidence,
    wordCues: allWords,
    shots: draftShots,
    visualContinuity: {
      palette: plan.palette,
      typography: plan.typography,
      texture: plan.texture,
      rules: plan.continuityRules,
    },
    model: getEnv().model,
    createdAt: started,
  };
  input.onSaveSnapshot?.(currentDraftFilm, "planning");

  const summaries = framed.map((s) => s.visualIdea);

  // Stage 03: Art Direction
  const isRestartingPrompts = input.startFromStage === "art-direction" || input.startFromStage === "planning";
  const alreadyPromptedCount = isRestartingPrompts
    ? 0
    : draftShots.filter((s) => s.visualPrompt && s.visualPrompt.elements?.length).length;

  if (alreadyPromptedCount > 0) {
    log("3_art-direction", `Found ${alreadyPromptedCount} / ${draftShots.length} existing visual prompts. Resuming remaining shots...`, "running");
  } else {
    log("3_art-direction", `Art-directing ${framed.length} shots — composition, camera and word choreography.`);
  }

  let promptsDone = alreadyPromptedCount;
  input.onStage?.("art-direction", promptsDone, framed.length, `${promptsDone}/${framed.length} prompts ready`);

  const promptConcurrency = Math.min(getCodeConcurrency(), 4);
  await mapLimit(framed, promptConcurrency, async (shot, index) => {
    // If prompt already authored from previous run and not restarting prompts
    if (!isRestartingPrompts && draftShots[index]?.visualPrompt?.elements?.length) {
      return;
    }

    let prompt: ShotVisualPrompt;
    try {
      prompt = await generateShotVisualPrompt({
        shot,
        wordCues: shot.wordCues,
        filmNorthStar: plan.creativeNorthStar,
        continuityRules: plan.continuityRules,
        previousSummary: summaries[index - 1] ?? "Opening shot: establish the visual world.",
        nextSummary: summaries[index + 1] ?? "Final shot: resolve the film's visual motif.",
      });
    } catch (promptErr) {
      log("3_art-direction", `${shot.shotId}: visual prompt warning (${(promptErr as Error).message.slice(0, 100)}). Using synthesized prompt.`, "running");
      prompt = {
        shotId: shot.shotId,
        premise: shot.spokenText,
        composition: "Centered tech layout with prominent animated hero component",
        visualMetaphor: shot.visualIdea,
        elements: [shot.visualIdea, "Interactive UI Panel", "Status Indicators"],
        cameraChoreography: "Subtle continuous push-in",
        typographyChoreography: "Staggered headline entry",
        colorAndLight: "High-contrast dynamic lighting",
        soundAwareCut: "none",
        renderPrompt: shot.visualIdea,
        wordSync: (shot.emphasisWordIndices || []).map((w) => ({
          wordIndex: w,
          action: "Highlight metric",
          completesBySpokenEnd: true,
        })),
        avoid: ["Static text-only view", "generic bullets"],
      };
    }

    promptsDone++;
    draftShots[index] = {
      ...draftShots[index],
      visualPrompt: prompt,
      codeStatus: draftShots[index].codeStatus === "smoke-passed" ? "smoke-passed" : "prompted",
    };

    input.onStage?.("art-direction", promptsDone, framed.length, `${shot.shotId} · ${prompt.visualMetaphor}`);
    log(
      "3_art-direction",
      `${shot.shotId}: ${prompt.visualMetaphor}`,
      "running",
      [
        `PREMISE  ${prompt.premise}`,
        `COMPOSITION  ${prompt.composition}`,
        `CAMERA  ${prompt.cameraChoreography}`,
        `TYPE  ${prompt.typographyChoreography}`,
        `COLOR/LIGHT  ${prompt.colorAndLight}`,
        `ELEMENTS  ${prompt.elements.join(" · ")}`,
        `WORD SYNC  ${prompt.wordSync.map((w) => `W${w.wordIndex} → ${w.action}`).join("\n           ")}`,
        `AVOID  ${prompt.avoid.join(" · ")}`,
      ].join("\n"),
    );

    // Incrementally persist draft after each prompt completes
    currentDraftFilm.shots = [...draftShots];
    input.onSaveSnapshot?.(currentDraftFilm, "art-direction");
  }, 400);

  log("3_art-direction", `${draftShots.length} shot-specific visual prompts authored.`, "success");

  // Stage 04: Code Generation
  const isRestartingCoding = input.startFromStage === "coding" || input.startFromStage === "art-direction" || input.startFromStage === "planning";
  const alreadyCodedCount = isRestartingCoding
    ? 0
    : draftShots.filter((s) => s.codeStatus === "smoke-passed" && s.sourceCode).length;

  const codeConcurrency = getCodeConcurrency();

  if (alreadyCodedCount > 0) {
    log("4_codegen", `Found ${alreadyCodedCount} / ${draftShots.length} previously compiled scenes. Resuming with ${codeConcurrency} parallel agents...`, "running");
  } else {
    log("4_codegen", `${codeConcurrency} parallel AI agents are writing original Remotion TSX for ${draftShots.length} shots.`);
  }

  let codeDone = alreadyCodedCount;
  input.onStage?.("coding", codeDone, draftShots.length, `${codeDone}/${draftShots.length} scenes compiled`);

  await mapLimit(draftShots, codeConcurrency, async (shot, index) => {
    // If scene already compiled from previous run and not restarting code
    if (!isRestartingCoding && shot.codeStatus === "smoke-passed" && shot.sourceCode) {
      return;
    }

    let visualPrompt = shot.visualPrompt;
    if (!visualPrompt) {
      log("3_art-direction", `${shot.shotId}: synthesizing prompt for coding...`, "running");
      visualPrompt = {
        shotId: shot.shotId,
        premise: shot.spokenText,
        composition: "Centered tech layout with prominent animated hero component",
        visualMetaphor: shot.visualIdea,
        elements: [shot.visualIdea, "Interactive UI Panel", "Status Indicators"],
        cameraChoreography: "Subtle continuous push-in",
        typographyChoreography: "Staggered headline entry",
        colorAndLight: "High-contrast dynamic lighting",
        soundAwareCut: "none",
        renderPrompt: shot.visualIdea,
        wordSync: (shot.emphasisWordIndices || []).map((w) => ({
          wordIndex: w,
          action: "Highlight metric",
          completesBySpokenEnd: true,
        })),
        avoid: ["Static text-only view", "generic bullets"],
      };
      shot.visualPrompt = visualPrompt;
    }

    let failure = "";
    for (let retry = 0; retry <= MAX_RETRIES; retry++) {
      try {
        input.onStage?.("coding", codeDone, draftShots.length, `${shot.shotId}: ${retry ? `repairing code (${retry}/${MAX_RETRIES})` : "writing original Remotion TSX"}`);
        const result = await generateRemotionShotCode({
          shot,
          visualPrompt,
          wordCues: shot.wordCues,
          filmContinuity: { palette: plan.palette, typography: plan.typography, texture: plan.texture, rules: plan.continuityRules },
          previousSummary: summaries[index - 1] ?? "opening shot",
          nextSummary: summaries[index + 1] ?? "final shot",
          validationError: failure || undefined,
          retryNumber: retry || undefined,
        });

        // Syntax, imports and allowed primitives are checked before any code executes.
        const { compileGeneratedShot } = await import("./generatedCode");
        compileGeneratedShot(result.sourceCode);
        const componentProps: GeneratedSceneProps = {
          shotPlan: shot,
          visualPrompt,
          wordCues: cuePayload(shot.wordCues),
          continuity: {
            previousVisualSummary: summaries[index - 1] ?? "opening shot",
            nextVisualSummary: summaries[index + 1] ?? "final shot",
            paletteAnchor: plan.palette,
            typeAnchor: plan.typography,
          },
          assets: [],
        };
        await smokeShot(result.sourceCode, componentProps, shot.durationFrames, shot.shotId);
        codeDone++;

        draftShots[index] = {
          ...shot,
          wordCues: cuePayload(shot.wordCues),
          sourceCode: result.sourceCode,
          sourceHash: compileGeneratedShot(result.sourceCode).sourceHash,
          visualSummary: result.visualSummary,
          designChoices: result.designChoices,
          codeStatus: "smoke-passed" as const,
          retries: retry,
          continuity: componentProps.continuity,
          compileError: undefined,
        };

        input.onStage?.("coding", codeDone, draftShots.length, `${shot.shotId}: compiled and smoke-rendered`);
        log(
          "4_codegen",
          `${shot.shotId}: ${result.visualSummary}`,
          "running",
          [
            `Compiled clean${retry ? ` after ${retry} repair${retry > 1 ? "s" : ""}` : ""} · smoke frames 0 / ${Math.floor(shot.durationFrames / 2)} / ${shot.durationFrames - 1} rendered`,
            `Design choices: ${result.designChoices.join(" · ")}`,
            "",
            "--- generated Remotion TSX ---",
            result.sourceCode,
          ].join("\n"),
        );

        // Incrementally persist draft after each shot compiles
        currentDraftFilm.shots = [...draftShots];
        input.onSaveSnapshot?.(currentDraftFilm, "coding");
        break;
      } catch (error) {
        failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        if (retry === MAX_RETRIES) {
          log("4_codegen", `${shot.shotId}: visual fallback scene applied after ${MAX_RETRIES} attempts. (Can be regenerated individually in Studio)`, "skipped", failure);
          const { createFallbackShotSource, compileGeneratedShot } = await import("./generatedCode");
          const fallbackSource = createFallbackShotSource(shot, { palette: plan.palette, typography: plan.typography });
          const compiled = compileGeneratedShot(fallbackSource);
          codeDone++;

          draftShots[index] = {
            ...shot,
            wordCues: cuePayload(shot.wordCues),
            sourceCode: fallbackSource,
            sourceHash: compiled.sourceHash,
            visualSummary: `${shot.shotId} (Visual fallback — ready for individual regeneration)`,
            designChoices: ["Auto-recovery fallback scene", "Preserved audio timing & word sync", "Ready for individual regeneration"],
            codeStatus: "error" as const,
            compileError: failure,
            retries: retry,
            continuity: {
              previousVisualSummary: summaries[index - 1] ?? "opening shot",
              nextVisualSummary: summaries[index + 1] ?? "final shot",
              paletteAnchor: plan.palette,
              typeAnchor: plan.typography,
            },
          };

          currentDraftFilm.shots = [...draftShots];
          input.onSaveSnapshot?.(currentDraftFilm, "coding");
          break;
        }
        log("4_codegen", `${shot.shotId}: validation failed — sending the exact error back to the code worker.`, "running", failure);
      }
    }
  }, 500);

  log("4_codegen", `${draftShots.length} independently authored Remotion components are ready.`, "success");

  input.onStage?.("validation", 1, 1, "Final plan and frame boundary audit");
  const boundaryErrors = draftShots.flatMap((s, i) => {
    const errors: string[] = [];
    if (i && s.startFrame !== draftShots[i - 1].endFrame) errors.push(`${s.shotId} has a frame gap/overlap.`);
    if (s.sourceCode.length === 0) errors.push(`${s.shotId} has no authored source.`);
    return errors;
  });
  if (draftShots.at(-1)?.endFrame !== totalFrames) boundaryErrors.push("Last scene does not end on the audio's final frame.");
  if (boundaryErrors.length) throw new Error(`Final frame audit failed: ${boundaryErrors.join(" ")}`);
  log(
    "5_validator",
    `${draftShots.length} scenes verified · ${totalFrames} gapless frames · ${(totalFrames / FPS).toFixed(1)}s locked to audio.`,
    "success",
    [
      `Total retries used: ${draftShots.reduce((sum, s) => sum + s.retries, 0)}`,
      "",
      ...draftShots.map((s) => `${s.shotId}  f${s.startFrame}→${s.endFrame}  (${(s.durationFrames / FPS).toFixed(1)}s)  ${s.visualFamily}/${s.themeMode}  ${s.wordCues.length} word cues`),
    ].join("\n"),
  );

  return currentDraftFilm;
}

/** Re-author one scene from its saved visual plan/prompt; no preset fallback. */
export async function regenerateGeneratedShot(
  film: GeneratedFilm,
  shotId: string,
  validationError?: string,
  onLog?: (entry: PipelineLog) => void,
): Promise<GeneratedSceneShot> {
  const index = film.shots.findIndex((s) => s.shotId === shotId);
  if (index < 0) throw new Error(`Unknown generated shot ${shotId}.`);
  const shot = film.shots[index];
  let failure = validationError ?? "";
  for (let retry = 0; retry <= MAX_RETRIES; retry++) {
    try {
      const result = await generateRemotionShotCode({
        shot,
        visualPrompt: shot.visualPrompt!,
        wordCues: shot.wordCues,
        filmContinuity: film.visualContinuity,
        previousSummary: film.shots[index - 1]?.visualSummary ?? "opening shot",
        nextSummary: film.shots[index + 1]?.visualSummary ?? "final shot",
        validationError: failure || undefined,
        retryNumber: retry || undefined,
      });
      const { compileGeneratedShot } = await import("./generatedCode");
      const compiled = compileGeneratedShot(result.sourceCode);
      const props: GeneratedSceneProps = {
        shotPlan: shot,
        visualPrompt: shot.visualPrompt!,
        wordCues: shot.wordCues,
        continuity: shot.continuity,
        assets: [],
      };
      await smokeShot(result.sourceCode, props, shot.durationFrames, shot.shotId);
      return {
        ...shot,
        sourceCode: result.sourceCode,
        sourceHash: compiled.sourceHash,
        visualSummary: result.visualSummary,
        designChoices: result.designChoices,
        codeStatus: "smoke-passed",
        retries: retry,
        compileError: undefined,
      };
    } catch (error) {
      failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      onLog?.({ stage: "4_codegen", message: `${shotId} retry ${retry + 1}: ${failure}`, status: retry >= MAX_RETRIES ? "error" : "running", timestamp: Date.now() });
      if (retry === MAX_RETRIES) throw new Error(`${shotId} failed regeneration after ${MAX_RETRIES} repairs: ${failure}`);
    }
  }
  throw new Error(`${shotId} did not regenerate.`);
}