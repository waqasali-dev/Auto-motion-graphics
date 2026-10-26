# FRAME/60 — Variety System Plan

## 1. Problem

The film had eight grammars, but they all read as "a headline, some cards, a bar or a photo". Nothing in the film could show a graph that draws itself, a connected system, or a case being built on screen. Variety was decided by hand, shot by shot, so it could not be checked, and nothing guaranteed that the film still felt like one film at the end.

## 2. Principles

1. **Variety is planned, not hoped for.** Every shot gets a family, an archetype, a theme and an act before any frame is drawn. The plan is validated against written rules.
2. **Variety lives inside one kit.** Shot families change composition, never the kit: one palette per theme, one type pairing, one easing curve, one entry/exit rhythm, one cut signature, one chapter rail.
3. **Content is a contract, not a layout.** Planners write a `Beat` (headline, figures, series, nodes, evidence, rows, results). Any archetype in the intent's candidate list can render a beat, so the planner can change layout without rewriting copy.
4. **The film has an arc.** Four acts (Hook, Evidence, Proof, Resolve) carry an energy level. Act structure drives candidate families, energy and where dark frames are allowed.

## 3. Taxonomy

### Families (5)
| Family | Purpose | Archetypes |
|---|---|---|
| Editorial | One idea, one line, one number | KineticHero, ScaleTradeoff, DarkImpactClose |
| Photographic | Real product imagery as evidence | SplitComparison, DeviceMockup |
| Graphs | Values that draw in step with the voice | ChartStory, BarComparison, PerspectiveDataGrid, BentoBadgeCluster |
| Connected | Nodes, edges, traveling packets | NetworkMesh, RadialHub |
| Investigation | Evidence, search, inspection | InvestigationBoard, MagnifierInspect, QueryTrace |

### Intents (13)
`hook, trend, evidence, search, inspect, system, compare, contrast, proof, summary, trace, stat, close`.
Each intent lists the archetypes that can render its content. A search beat can only land on a search-capable layout, and a board beat only on the evidence board. Some intents have a single candidate on purpose, so the content always matches the layout.

### Acts (4)
| Act | Share of runtime | Energy | Expected families |
|---|---|---|---|
| I · Hook | first 15% | 1 | editorial, graphs |
| II · Evidence | 15% to 45% | 3 | investigation, connected |
| III · Proof | 45% to 80% | 2 | graphs, photographic |
| IV · Resolve | last 20% | 1 | editorial, graphs |

### Archetypes (14)
Eight existing grammars plus six new ones:
- **ChartStory** (graphs). A line chart draws along the voice; a callout pins to the peak.
- **BarComparison** (graphs). Ranked bars count up and a donut shows the ratio of the winner.
- **NetworkMesh** (connected). A layered graph (transcript, planner, five workers, validator). Edges draw in sequence and packets travel along them.
- **InvestigationBoard** (investigation, fixed dark). Evidence cards are pinned to a board and joined by red strings. A stamp closes the case.
- **MagnifierInspect** (investigation). A transcript table is inspected by a magnifier lens that travels down the rows and stops on the flagged row.
- **QueryTrace** (investigation). A search query types itself, the results cascade in ranked order, and the top hit is highlighted.

## 4. The Planner

`planVariety(beats, policy)` runs as a deterministic depth-first search over the film:

- **Hard constraints**
  - No archetype may repeat in the next shot.
  - No archetype may repeat within `repeatWindow` (4) shots. If the search cannot satisfy this, it relaxes the window one shot at a time and the report says so. The shipped film solves at the full window with no relaxation.
  - No more than `maxFamilyRun` (2) consecutive shots from one family.
  - Fixed-dark archetypes count against the dark budget. The budget is `floor(maxDarkShare × shots)`, with `maxDarkShare = 0.15` from the spec.
- **Soft scoring** (orders the search)
  - +4 for a different family from the previous shot.
  - +3 for an archetype not yet used in the film.
  - +2 per family that is under-represented against an even share.
  - +2 when the family matches the act's expected families.
  - A small bonus for earlier entries in the intent's candidate list.
- **Theme pass.** Fixed-dark archetypes keep their theme. Flexible archetypes take the remaining dark budget, preferring the Evidence and Resolve acts and never sitting next to another dark shot.
- **Frame pass.** Durations are summed into integer frame boundaries, so shot N starts exactly where shot N−1 ends.
- **Audit.** The report lists family counts, distinct archetypes, dark share, the longest family run, adjacent repeats, act coverage, and a list of violations. It also gives each shot a reasons array, so the plan can be read back.

## 5. Consistency Kit (applies to every shot)

| Element | Rule | Where |
|---|---|---|
| Palette | Light and dark token sets, no per-archetype colours | `sdk/kit.ts` |
| Type | Sans for statements, serif italic for the accent word, mono for labels | `sdk/kit.ts`, `index.css` |
| Entry rhythm | Every element enters in 16 frames, staggered by 8 | `KIT` |
| Exit | 12-frame blur-fade (ShotEnvelope) | `sdk/ShotEnvelope.tsx` |
| Cut signature | A light band sweeps across the first and last 14 frames of every shot | `sdk/continuity.tsx` |
| Chapter rail | A hairline at the bottom shows act segments, the film playhead, and the act and family | `sdk/continuity.tsx` |
| Global clock | The rail playhead is measured against the whole film, so it never resets between shots | `ChapterRail` |

The rail and cut signature are applied as an overlay at the stage level, so every archetype gets them without changes to its own code.

## 6. Content Contract

`Beat` carries the copy. `toSceneContent(archetype, beat)` maps a beat onto the props each archetype already accepts, so the eight original grammars keep working unchanged. New archetypes read `content.beat` directly and fall back to sensible defaults when a field is missing.

## 7. Implementation Map

| Step | File |
|---|---|
| Shared types and the plan contract | `src/sdk/contract.ts` |
| Palette, kit timing, image paths | `src/sdk/kit.ts` |
| Chart primitives (line, bar, donut) | `src/sdk/charts.tsx` |
| Mesh primitives (layered layout, bezier edges, packets) | `src/sdk/mesh.tsx` |
| Investigation primitives (evidence card, string, stamp, sweep, typing) | `src/sdk/investigation.tsx` |
| Six new archetypes | `src/sdk/archetypesExtended.tsx` |
| Merged archetype registry | `src/sdk/registry.ts` |
| Continuity overlay (cut sweep, chapter rail, ShotStage) | `src/sdk/continuity.tsx` |
| Family, act, intent, and archetype metadata | `src/variety/taxonomy.ts` |
| Beat to scene-content adapters | `src/variety/adapters.ts` |
| The planner and its audit | `src/variety/planner.ts` |
| The 14-beat film | `src/data/film.ts` |
| Player using the planned film | `src/components/ShotPlayer.tsx` |
| Plan visualisation (family swimlanes, audit, kit) | `src/components/VarietyAudit.tsx` |

## 8. Verification

- The planner must report zero violations for the shipped film and must never place a repeated archetype next to itself.
- Every archetype must render at the first, middle and last frame with no NaN or undefined values.
- `npm run build` must pass.

## 9. Studio — your audio + transcript → same locked film

The demo film is now also the template for user uploads.

**Projects are local-only:** metadata in `localStorage`, audio blobs in `IndexedDB` (so large files survive the 5 MB quota), no server, no DB. Users can export/import a project as JSON and re-upload audio if needed. The header shows `N projects · local` and every project card previews its first shot as a real `FilmStage` still.

**Uploads → pipeline:**
1. User drops `audio.mp3/wav/m4a` + pastes text or uploads `transcript.json` (Whisper `verbose_json` with `words`/`segments`) / `txt` / `srt`.
2. `textToRawTranscript(text, audioDuration) ` synthesizes word timings proportional to character count if no word-level JSON exists.
3. Stage 1 preprocessor strips `onsets`/`chunks`, flags `confidence < 0.5` or duplicate words, emits `[S{i} | {start}s-{end}s | words:{a}..{b}] "{text}"` digest.
4. Stage 2 planner calls OpenAI with `VITE_OPENAI_API_KEY / BASE_URL / MODEL` from `.env` (or Settings UI → localStorage override). The prompt forbids timestamps — LLM outputs only `sentenceStartIndex`/`sentenceEndIndex` + `archetype`/`themeMode`/`highlightWords`/`visualInstructions`. If the key is missing or the call fails, the deterministic taxonomy search fallback runs locally.
5. Stage 3 middleware computes `startFrame = round(end * 60)`, `Shot[N].startFrame = Shot[N-1].endFrame`, `localStartFrame = max(0, round((word.start - shotStart) * 60) - 4)` pre-roll.
6. Stage 3 output beats are fed into the existing `planVariety` / taxonomy search so the edit still respects anti-repetition, `maxFamilyRun = 2`, `repeatWindow = 4`, and 15 % dark cap.
7. Stage 5 validator smoke-renders frames `0, ⌊d/2⌋, d-1` (simulated in-browser).

**Audio-deterministic playback:** once audio is present, `useAudioSync` makes `<audio>` the clock — `frame = floor(audio.currentTime * 60)`. The DAW-style timeline shows waveform + shot clips + act spans + playhead. Scrubbing seeks `audio.currentTime`. Without audio, the demo falls back to an rAF clock. The film finish, motion blur, and transitions stay identical — only the clock source changes.

**OpenAI integration:** `src/services/env.ts` reads `VITE_OPENAI_*` with localStorage precedence; `src/services/openai.ts` creates the `OpenAI` client with `dangerouslyAllowBrowser: true` (key is user-owned). Structured Outputs (`json_schema`) enforces the `ShotPlan` schema. `VITE_OPENAI_BASE_URL` enables proxies/compatible APIs. Settings dialog shows key preview, model, base URL, and a `models.list()` test.

## 10. Motion-graphics render layer (replaces the web-layout scenes)

The first scene set read as web UI: responsive flex and grid, rounded cards with borders, pills, mono labels, per-element fades, and a canvas background on its own clock. The render layer was rebuilt the way a motion designer builds a comp.

| Web habit (removed) | Motion-graphics replacement | Where |
|---|---|---|
| Responsive layout that reflows | Fixed 1920×1080 comp, scaled as one picture | `mg/core.tsx` `Composition` |
| CSS-style eases, fade-ins | Bezier keyframes (`kf`), snap and expo curves, overshoot | `mg/core.tsx` |
| Static framing | 2D camera (push, pan, pull-back, focus travel) and 3D dolly | `Camera`, scene code |
| Fast moves with no blur | Directional motion blur scaled by per-frame velocity | `mb()`, `FxDefs` |
| Opacity fade on text | Track-matte masked rises, per-word stagger, tracking expand | `Rise`, `Words` |
| Number labels | Rolling-digit odometers | `Odometer` |
| Borders and dividers | Trim-path strokes that draw on | `trim()` |
| Each shot fades itself out | Transitions between shots: whip pan, zoom-through, punch cut with flash frame, branded act wipe with chapter card | `mg/stage.tsx` |
| UI progress rail | Broadcast corner bug | `stage.tsx` `Bug` |
| Flat digital frame | Animated grain and vignette | `FilmFinish` |

The planner also plans the edit. An act change gets a branded wipe, a high-energy beat gets a punch cut, a same-family follow-up zooms through, and family changes alternate whip and zoom so no cut style dominates.

## 11. Out of scope (next iteration)

- Stage 2 LLM output of `intent` and `beat` directly from the transcript.
- Real audio-driven timing for chart draws and packet travel.
