// src/services/openai.ts
// OpenAI & AgentRouter SDK wrapper — all LLM calls go through here.
// Reads config from env service, supports custom baseURL/model via .env or Settings UI.
// Supports both OpenAI /v1/chat/completions and AgentRouter /v1/responses.

import OpenAI from "openai";
import { getEnv, hasValidKey, getEffectiveBaseURL, isAgentRouter } from "./env";
import type { ShotPlanJSON } from "../sdk/contract.pipeline";
import type {
  CreativePlanOutput,
  CreativeShotPlan,
  GeneratedCodeOutput,
  ShotVisualPrompt,
  WordCue,
} from "../sdk/contract.generated";

export const AGENTROUTER_HEADERS: Record<string, string> = {
  "User-Agent": "claude-cli/1.0.108 (external, cli)",
  "x-app": "cli",
};

const NO_THINKING_DIRECTIVE =
  "[IMPORTANT DIRECTIVE: DO NOT GENERATE ANY CHAIN-OF-THOUGHT, THINKING, SCRATCHPAD, OR <think> TAGS. RESPOND DIRECTLY WITH THE FINAL OUTPUT ONLY.]";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Lazy client — recreated when env changes
let _client: OpenAI | null = null;
let _clientKey: string | null = null;

export function getClient(): OpenAI | null {
  if (!hasValidKey()) return null;
  const env = getEnv();
  const effectiveBase = getEffectiveBaseURL();
  const key = `${env.apiKey}::${effectiveBase}`;
  if (_client && _clientKey === key) return _client;
  _client = new OpenAI({
    apiKey: env.apiKey,
    baseURL: effectiveBase,
    dangerouslyAllowBrowser: true, // required for client-side usage — key is user-owned
    defaultHeaders: AGENTROUTER_HEADERS,
  });
  _clientKey = key;
  return _client;
}

export function resetClient() {
  _client = null;
  _clientKey = null;
}

export interface AgentRouterRequestOptions {
  messages?: Array<{ role: string; content: string }>;
  systemInstruction?: string | null;
  prompt?: string;
  model?: string;
  temperature?: number | null;
  maxOutputTokens?: number | null;
  responseJsonSchema?: Record<string, unknown> | null;
  maxAttempts?: number;
  onLog?: (msg: string) => void;
}

export function parseJsonOutput<T>(raw: string): T {
  let clean = raw.trim();
  if (clean.startsWith("```")) {
    clean = clean.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
  }
  const firstBrace = clean.indexOf("{");
  const lastBrace = clean.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    clean = clean.substring(firstBrace, lastBrace + 1);
  }
  try {
    return JSON.parse(clean) as T;
  } catch (e) {
    throw new Error(`The model returned invalid JSON: ${(e as Error).message}\nOutput: ${clean.slice(0, 300)}`);
  }
}

/**
 * Primary request function for AgentRouter using /v1/responses instead of /v1/chat/completions.
 */
export async function sendAgentRouterRequest(options: AgentRouterRequestOptions | string): Promise<string> {
  const env = getEnv();
  if (!hasValidKey()) {
    throw new Error("AgentRouter credentials missing: please set VITE_OPENAI_API_KEY and VITE_OPENAI_BASE_URL.");
  }

  const opts: AgentRouterRequestOptions = typeof options === "string" ? { prompt: options } : options;
  const {
    prompt,
    messages: providedMessages,
    systemInstruction = null,
    temperature = null,
    maxOutputTokens = null,
    responseJsonSchema = null,
    maxAttempts = 4,
    onLog = console.log,
  } = opts;

  const model = opts.model || env.model || "gpt-6.1-sol";
  const effectiveBase = getEffectiveBaseURL().replace(/\/+$/, "");

  // Build messages array
  const messages: Array<{ role: string; content: string }> = [];

  let systemContent = systemInstruction || "";
  if (responseJsonSchema) {
    systemContent = `${systemContent}\n\nSTRICT JSON CONTRACT: You must respond ONLY with a valid JSON object matching this schema:\n${JSON.stringify(responseJsonSchema, null, 2)}\nDo NOT wrap in prose. Return valid JSON only.`;
  }

  const fullSystem = systemContent ? `${NO_THINKING_DIRECTIVE}\n\n${systemContent}` : NO_THINKING_DIRECTIVE;
  messages.push({ role: "system", content: fullSystem });

  if (providedMessages && providedMessages.length > 0) {
    for (const turn of providedMessages) {
      if (turn.role !== "system") {
        messages.push({ role: turn.role === "assistant" ? "assistant" : "user", content: turn.content });
      }
    }
  } else if (prompt) {
    messages.push({ role: "user", content: prompt });
  }

  const tokenLimit = maxOutputTokens || 16384;
  const reqBody: Record<string, any> = {
    model,
    input: messages,
    max_tokens: tokenLimit,
    max_completion_tokens: tokenLimit,
    reasoning_effort: "none",
    reasoning: { effort: "none", max_tokens: 0 },
    thinking: { type: "disabled" },
    chat_template_kwargs: { thinking: false },
  };

  const isReasoningOrAgentRouter = isAgentRouter() || /o1|o3|sol|astra|gpt-6|gpt-5/i.test(model);
  // Reasoning models and AgentRouter /v1/responses reject custom temperature values with 400 Bad Request.
  if (temperature !== null && !isReasoningOrAgentRouter) {
    reqBody.temperature = temperature;
  }

  const endpoint = `${effectiveBase}/responses`;
  onLog(`[AgentRouter] Sending request to ${model} via ${endpoint}...`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.apiKey}`,
          "Content-Type": "application/json",
          ...AGENTROUTER_HEADERS,
        },
        body: JSON.stringify(reqBody),
      });

      if (!res.ok) {
        const errText = await res.text();
        let errJson: any = null;
        try {
          errJson = JSON.parse(errText);
        } catch {}
        const msg = errJson?.error?.message || errText || `HTTP ${res.status}`;
        throw new Error(msg);
      }

      const data = await res.json();
      if (data?.error) {
        throw new Error(data.error.message || JSON.stringify(data.error));
      }

      // Extract output from /v1/responses response object
      const msgItem = data.output?.find((item: any) => item.type === "message");
      let text =
        msgItem?.content?.find((c: any) => c.text)?.text ||
        msgItem?.content?.[0]?.text ||
        (typeof msgItem?.content === "string" ? msgItem.content : "");

      // Fallback: If content is empty but model dumped text in reasoning
      if (!text) {
        const reasoningItem = data.output?.find((item: any) => item.type === "reasoning");
        text = reasoningItem?.text || "";
      }

      // Fallback: standard choices structure if gateway returned choices
      if (!text && data.choices?.[0]?.message?.content) {
        text = data.choices[0].message.content;
      }

      if (!text) {
        throw new Error("Model returned an empty response with no content.");
      }

      return text;
    } catch (err) {
      const errMsg = (err as Error).message || "";
      let stripped = false;

      // Automatically strip unsupported parameters if the gateway rejects them (e.g. Unsupported parameter: 'temperature')
      const unsupportedParamMatch = errMsg.match(/Unsupported parameter: ['"]?([a-zA-Z0-9_]+)['"]?/i);
      if (unsupportedParamMatch && unsupportedParamMatch[1]) {
        const paramName = unsupportedParamMatch[1];
        if (reqBody[paramName] !== undefined) {
          delete reqBody[paramName];
          stripped = true;
        }
      }

      // Handle gateways that reject specific reasoning parameters with 400 Bad Request
      if (/temperature/i.test(errMsg) && reqBody.temperature !== undefined) {
        delete reqBody.temperature;
        stripped = true;
      }
      if (/reasoning_effort/i.test(errMsg) && reqBody.reasoning_effort) {
        delete reqBody.reasoning_effort;
        stripped = true;
      }
      if (/reasoning/i.test(errMsg) && reqBody.reasoning) {
        delete reqBody.reasoning;
        stripped = true;
      }
      if (/thinking/i.test(errMsg) && reqBody.thinking) {
        delete reqBody.thinking;
        stripped = true;
      }
      if (/chat_template_kwargs/i.test(errMsg) && reqBody.chat_template_kwargs) {
        delete reqBody.chat_template_kwargs;
        stripped = true;
      }
      if (/max_completion_tokens/i.test(errMsg) && reqBody.max_completion_tokens) {
        delete reqBody.max_completion_tokens;
        stripped = true;
      }

      if (stripped) {
        onLog(`[AgentRouter] Gateway rejected configuration parameter(s); retrying without them...`);
        continue;
      }

      onLog(`[AgentRouter] Attempt ${attempt} failed: ${errMsg}`);
      if (attempt < maxAttempts) {
        const isTransient = /unreachable|empty response|500|502|503|504|ECONNRESET|fetch failed/i.test(errMsg);
        const waitMs = isTransient ? Math.max(2500, 1500 * attempt) : 1200 * attempt;
        await sleep(waitMs);
        continue;
      }
      throw err;
    }
  }

  throw new Error("Failed to receive response from AgentRouter.");
}


// ──────────────────────────────────────────────────────────────────────────────
// Planner LLM — Master ShotPlan generation via Structured Outputs
// ──────────────────────────────────────────────────────────────────────────────

const SHOTPLAN_SCHEMA = {
  name: "shot_plan",
  strict: true,
  schema: {
    type: "object",
    properties: {
      shots: {
        type: "array",
        items: {
          type: "object",
          properties: {
            shotId: { type: "string", description: "Shot_NN format e.g. Shot_01" },
            sentenceStartIndex: { type: "integer" },
            sentenceEndIndex: { type: "integer" },
            cleanedDisplaySentences: { type: "array", items: { type: "string" } },
            archetype: {
              type: "string",
              enum: [
                "KineticHero",
                "SplitComparison",
                "PerspectiveDataGrid",
                "RadialHub",
                "DeviceMockup",
                "BentoBadgeCluster",
                "ScaleTradeoff",
                "DarkImpactClose",
                "ChartStory",
                "BarComparison",
                "NetworkMesh",
                "InvestigationBoard",
                "MagnifierInspect",
                "QueryTrace",
              ],
            },
            themeMode: { type: "string", enum: ["light", "dark"] },
            highlightWords: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  wordIndex: { type: "integer" },
                  tone: { type: "string", enum: ["blue", "red", "green", "cyan", "gold"] },
                },
                required: ["wordIndex", "tone"],
                additionalProperties: false,
              },
            },
            visualInstructions: { type: "string" },
          },
          required: ["shotId", "sentenceStartIndex", "sentenceEndIndex", "cleanedDisplaySentences", "archetype", "themeMode", "highlightWords", "visualInstructions"],
          additionalProperties: false,
        },
      },
    },
    required: ["shots"],
    additionalProperties: false,
  },
} as const;

export async function planWithLLM(digestLines: string[], onProgress?: (msg: string) => void): Promise<ShotPlanJSON> {
  const env = getEnv();
  const model = env.plannerModel || env.model;

  onProgress?.(`Calling ${model} planner...`);

  const systemPrompt = `You are FRAME/60 Master Planner — a deterministic video shot planner.

RULES (MANDATORY):
- Group sentences into semantic shots lasting 8s to 15s each.
- You are FORBIDDEN from outputting raw timestamps. Output ONLY sentenceStartIndex and sentenceEndIndex (indices into the digest).
- Archetype must be one of 14 locked values. Anti-repetition: never repeat the same archetype consecutively.
- Dark theme may not exceed 15% of total shots — use sparingly, for evidence/impact moments.
- Clean ASR typos in cleanedDisplaySentences (fix obvious errors) but never mutate timing.
- HighlightWords tone mapping: blue=informational, red=critical/warning, green=success, cyan=tech, gold=premium.
- visualInstructions must map specific spoken words to SDK components with timing cues.

You receive a compact digest:
[S{index} | {start}s-{end}s | words:{wordStart}..{wordEnd}] "{text}"

Example digest:
[S0 | 0.00s-3.20s | words:0..6] "Every single frame is spoken never approximated"
[S1 | 3.20s-8.10s | words:7..18] "The preprocessor strips token bloat and flags ASR typos"

Output strictly valid ShotPlan JSON. Shots must be contiguous and cover all sentences.`;

  const userPrompt = `Plan shots for this transcript (${digestLines.length} sentences):

${digestLines.join("\n")}

Requirements:
- Produce ${Math.ceil(digestLines.length / 2.5)} to ${Math.ceil(digestLines.length / 1.2)} shots (8-15s each)
- Fix any ASR typos for display text
- Vary archetypes — never repeat consecutively
- Keep dark theme ≤15% of shots`;

  if (isAgentRouter() || model.includes("sol") || model.includes("astra")) {
    const raw = await sendAgentRouterRequest({
      model,
      systemInstruction: systemPrompt,
      prompt: userPrompt,
      responseJsonSchema: SHOTPLAN_SCHEMA.schema,
      maxOutputTokens: 8000,
      onLog: onProgress,
    });
    const parsed = parseJsonOutput<ShotPlanJSON>(raw);
    onProgress?.(`Planner complete — ${parsed.shots?.length ?? 0} shots generated`);
    return parsed;
  }

  const client = getClient();
  if (!client) throw new Error("OpenAI API key not configured. Set VITE_OPENAI_API_KEY in .env or via Settings.");

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: SHOTPLAN_SCHEMA,
    },
    temperature: 0.7,
    max_tokens: 8000,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("Planner LLM returned empty response");
  const parsed = parseJsonOutput<ShotPlanJSON>(content);
  onProgress?.(`Planner complete — ${parsed.shots?.length ?? 0} shots generated`);
  return parsed;
}

// ──────────────────────────────────────────────────────────────────────────────
// Whisper Transcription
// ──────────────────────────────────────────────────────────────────────────────

export async function transcribeAudio(file: File, onProgress?: (msg: string) => void): Promise<{ text: string; words?: Array<{ text: string; start: number; end: number; confidence: number }> }> {
  if (isAgentRouter()) {
    throw new Error("AgentRouter endpoints route LLM inference and do not provide Whisper audio transcription. Please paste your transcript text or upload word-timed JSON directly.");
  }

  const client = getClient();
  if (!client) throw new Error("OpenAI API key not configured for transcription.");
  onProgress?.("Transcribing audio via Whisper...");

  const transcription = await (client.audio.transcriptions.create as unknown as (p: Record<string, unknown>) => Promise<unknown>)({
    file,
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["word", "segment"],
  });

  const data = transcription as unknown as {
    text: string;
    words?: Array<{ word: string; start: number; end: number; confidence?: number }>;
    segments?: Array<{ text: string; start: number; end: number; words?: Array<{ word: string; start: number; end: number }> }>;
  };
  onProgress?.(`Transcribed ${data.text?.length ?? 0} chars`);

  // Prefer Whisper word timestamps. Older/compatible endpoints may only return segments;
  // split each segment over its words while preserving the segment's real audio interval.
  const timedWords = data.words?.length
    ? data.words
    : (data.segments ?? []).flatMap((segment) => {
        const tokens = segment.text.trim().split(/\s+/).filter(Boolean);
        const span = Math.max(0.01, segment.end - segment.start);
        return tokens.map((word, i) => ({
          word,
          start: segment.start + (span * i) / Math.max(1, tokens.length),
          end: segment.start + (span * (i + 1)) / Math.max(1, tokens.length),
          confidence: 0.72,
        }));
      });
  const words = timedWords?.map((w) => ({ text: w.word, start: w.start, end: w.end, confidence: w.confidence ?? 0.92 }));

  return { text: data.text, words };
}

// ──────────────────────────────────────────────────────────────────────────────
// ASR Typo Cleanup helper — uses LLM to fix display text only (not timing)
// ──────────────────────────────────────────────────────────────────────────────

export async function cleanupDisplayText(sentences: string[]): Promise<string[]> {
  const env = getEnv();
  if (!hasValidKey()) return sentences; // no key = return as-is
  const sys = "Fix ASR typos in these sentences. Correct obvious misheard words, duplicate phrases (e.g. 'times, inspired times' -> 'times, inspired'), but preserve meaning exactly. Return JSON: { \"cleaned\": string[] } in same order.";
  const prompt = JSON.stringify(sentences);

  try {
    if (isAgentRouter() || env.model.includes("sol") || env.model.includes("astra")) {
      const raw = await sendAgentRouterRequest({
        systemInstruction: sys,
        prompt,
        responseJsonSchema: {
          type: "object",
          properties: { cleaned: { type: "array", items: { type: "string" } } },
          required: ["cleaned"],
        },
        temperature: 0.2,
      });
      const parsed = parseJsonOutput<{ cleaned: string[] }>(raw);
      if (Array.isArray(parsed.cleaned) && parsed.cleaned.length === sentences.length) return parsed.cleaned;
      return sentences;
    }

    const client = getClient();
    if (!client) return sentences;
    const res = await client.chat.completions.create({
      model: env.model,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });
    const parsed = JSON.parse(res.choices[0].message.content || "{}");
    if (Array.isArray(parsed.cleaned) && parsed.cleaned.length === sentences.length) return parsed.cleaned;
    return sentences;
  } catch {
    return sentences;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Dynamic motion-graphics director — no archetype/template output
// ──────────────────────────────────────────────────────────────────────────────

const VISUAL_FAMILIES = ["editorial", "photo", "data", "mesh", "investigation"] as const;
const CUTS = ["none", "punch", "whip", "zoom", "brandWipe"] as const;

const CREATIVE_PLAN_SCHEMA = {
  name: "creative_film_plan",
  strict: true,
  schema: {
    type: "object",
    properties: {
      filmTitle: { type: "string" },
      creativeNorthStar: { type: "string" },
      palette: { type: "string" },
      typography: { type: "string" },
      texture: { type: "string" },
      continuityRules: { type: "array", items: { type: "string" } },
      shots: {
        type: "array",
        items: {
          type: "object",
          properties: {
            shotId: { type: "string" },
            sentenceStartIndex: { type: "integer" },
            sentenceEndIndex: { type: "integer" },
            spokenText: { type: "string" },
            cleanedDisplaySentences: { type: "array", items: { type: "string" } },
            purpose: { type: "string" },
            visualIdea: { type: "string" },
            keyEvidence: { type: "array", items: { type: "string" } },
            emphasisWordIndices: { type: "array", items: { type: "integer" } },
            visualFamily: { type: "string", enum: VISUAL_FAMILIES },
            themeMode: { type: "string", enum: ["light", "dark"] },
            energy: { type: "integer", enum: [1, 2, 3] },
            transitionIn: { type: "string", enum: CUTS },
            transitionDirection: { type: "integer", enum: [-1, 1] },
            continuityNote: { type: "string" },
          },
          required: [
            "shotId", "sentenceStartIndex", "sentenceEndIndex", "spokenText", "cleanedDisplaySentences",
            "purpose", "visualIdea", "keyEvidence", "emphasisWordIndices", "visualFamily", "themeMode",
            "energy", "transitionIn", "transitionDirection", "continuityNote",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["filmTitle", "creativeNorthStar", "palette", "typography", "texture", "continuityRules", "shots"],
    additionalProperties: false,
  },
} as const;

const VISUAL_PROMPT_SCHEMA = {
  name: "shot_visual_prompt",
  strict: true,
  schema: {
    type: "object",
    properties: {
      shotId: { type: "string" },
      premise: { type: "string" },
      composition: { type: "string" },
      visualMetaphor: { type: "string" },
      elements: { type: "array", items: { type: "string" } },
      cameraChoreography: { type: "string" },
      typographyChoreography: { type: "string" },
      wordSync: {
        type: "array",
        items: {
          type: "object",
          properties: {
            wordIndex: { type: "integer" },
            action: { type: "string" },
            completesBySpokenEnd: { type: "boolean" },
          },
          required: ["wordIndex", "action", "completesBySpokenEnd"],
          additionalProperties: false,
        },
      },
      colorAndLight: { type: "string" },
      soundAwareCut: { type: "string" },
      avoid: { type: "array", items: { type: "string" } },
      renderPrompt: { type: "string" },
    },
    required: [
      "shotId", "premise", "composition", "visualMetaphor", "elements", "cameraChoreography",
      "typographyChoreography", "wordSync", "colorAndLight", "soundAwareCut", "avoid", "renderPrompt",
    ],
    additionalProperties: false,
  },
} as const;

const GENERATED_CODE_SCHEMA = {
  name: "remotion_shot_component",
  strict: true,
  schema: {
    type: "object",
    properties: {
      sourceCode: { type: "string" },
      visualSummary: { type: "string" },
      usedWordIndices: { type: "array", items: { type: "integer" } },
      designChoices: { type: "array", items: { type: "string" } },
    },
    required: ["sourceCode", "visualSummary", "usedWordIndices", "designChoices"],
    additionalProperties: false,
  },
} as const;

async function structured<T>(
  schema: { name: string; strict: true; schema: Record<string, unknown> },
  system: string,
  prompt: string,
  options: { model?: string; temperature?: number; maxTokens?: number } = {},
): Promise<T> {
  const env = getEnv();
  if (!hasValidKey()) {
    throw new Error("OpenAI API key is required for AI-authored motion graphics. Configure VITE_OPENAI_API_KEY in .env or Studio Settings.");
  }

  const model = options.model ?? env.model;

  if (isAgentRouter() || model.includes("sol") || model.includes("astra")) {
    const raw = await sendAgentRouterRequest({
      model,
      systemInstruction: system,
      prompt,
      responseJsonSchema: schema.schema,
      temperature: null,
      maxOutputTokens: options.maxTokens ?? 16000,
    });
    return parseJsonOutput<T>(raw);
  }

  const client = getClient();
  if (!client) throw new Error("OpenAI client initialization failed.");
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_schema", json_schema: schema as never },
    temperature: options.temperature ?? 0.55,
    max_tokens: options.maxTokens ?? 6000,
  });
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("The model returned an empty structured response.");
  return parseJsonOutput<T>(content);
}

const wordTable = (words: WordCue[]) =>
  words.map((w) => `W${w.wordIndex} f${w.startFrame}-${w.spokenEndFrame} (+${w.pauseFrames}p) ${JSON.stringify(w.text)}${w.confidence < 0.5 ? " [ASR FLAG]" : ""}`).join("\n");

export interface PlanWindow {
  /** 0-based window number and total, for multi-part planning of long films. */
  index: number;
  total: number;
  /** Absolute sentence indices this window must cover, inclusive. */
  sentenceStart: number;
  sentenceEnd: number;
  /** Visual ideas already used earlier in the film, so this window stays fresh. */
  previousShotSummaries: string[];
  /** Style locked by the first window; later windows must inherit it. */
  lockedStyle?: { northStar: string; palette: string; typography: string; texture: string; continuityRules: string[] };
  /** Families of the final shots before this window, to avoid run violations at the seam. */
  trailingFamilies: string[];
  /** How many dark shots this window may use. */
  darkBudget: number;
}

/** Stage 2: map every sentence to original, word-aligned visual storytelling. */
export async function planCreativeFilm(args: {
  transcriptDigest: string[];
  words: WordCue[];
  durationFrames: number;
  referenceStyle: string;
  creativeBrief?: string;
  repairErrors?: string[];
  window?: PlanWindow;
}): Promise<CreativePlanOutput> {
  const system = `You are the CREATIVE DIRECTOR and MOTION GRAPHICS SUPERVISOR for a bespoke Remotion 2D animated film (1920x1080 @ 60fps).

PRIMARY VISUAL AESTHETIC — HIGH-END 2D TECH MOTION DESIGN:
The visual standard is modern, broadcast-grade 2D animated graphics inspired by high-profile tech keynotes, clean product launch videos, and the demo reel:
- Sleek floating comparison cards (light and dark themed panels, rounded corners, subtle diffuse shadows, slight 2° tilt, brand/model badges, context/pricing stats, and animated callout focus frames).
- Clean data storytelling (animated SVG line charts with gradient fills and peak pins, ranked bar comparisons growing with spring physics, percentage donut ratios).
- Connected architecture meshes (clean service/pipeline node badges connected by curved bezier paths with glowing traveling data pulses).
- Bento metric clusters & spec slabs (structured 2-4 card grids with tabular numerals, rolling odometers, and status pills).
- Kinetic typography heroes (bold editorial statements, word-synced animated reveals with serif italic accents, expanding capsule highlights).
- Query & inspection traces (search bar/terminal query typing itself out, cascading ranked result cards with score tags, table magnifier focus).

CRITICAL DIRECTIVE — ANTI-ILLUSTRATION RULE:
DO NOT attempt to generate literal figurative illustrations or complex physical sketches:
- STRICTLY FORBIDDEN: Human body outlines, anatomical drawings, limb schematics, or faces.
- STRICTLY FORBIDDEN: Mechanical sketches of robotic arms, gears, propulsion backpacks, physical vehicles, or machinery drawn with raw SVG paths.
Complex figurative drawings look messy, distorted, and amateurish. Motion graphics communicate through clean, geometric 2D graphic layouts: floating cards, metric slabs, callout highlight boxes, typography, charts, and node graphs.

VISUAL FAMILIES (Plan diverse 2D motion graphics across these 5 disciplines):
1. 'editorial': Bold kinetic typography slam, expanding capsule pill with rolling numerals, high-contrast dark impact resolution.
2. 'photo' (Comparison/Contrast): Sleek floating UI cards (e.g. comparing two models, pricing tiers, or options with badges, context limits, and vibrant orange/coral callout focus frames).
3. 'data': Animated line/area charts with glowing strokes, ranked bar comparisons that grow into place, or bento metric grids.
4. 'mesh': Connected node architecture (e.g., pipeline stages, services, models) linked by animated curved connector lines with pulsing packets.
5. 'investigation': Search query typing out with cascading result cards, or data table with an animated magnifier lens/callout frame locking onto the key row.

WORD ALIGNMENT IS SACRED:
The provided word list has global integer frame starts, spoken ends, pause frames, and ASR confidence. Use those global word indices for emphasis. Never invent or rewrite the spoken transcript. Never output float timestamps. Shot boundaries are sentence indices only; the runtime derives all frame times.

NARRATIVE RULES:
- All sentences covered exactly once, in order, without overlap or gaps.
- Shot length follows content: normally 8-15 seconds per shot.
- Diverse visual families across the acts.
- No adjacent repeat of the same visualFamily; no more than 2 consecutive shots from the same family.
- Every shot must contain a distinct, transcript-grounded 2D motion graphic layout.`;

  const w = args.window;
  const first = w ? w.sentenceStart : 0;
  const last = w ? w.sentenceEnd : args.transcriptDigest.length - 1;
  const windowBrief = w
    ? `
THIS IS PART ${w.index + 1} OF ${w.total} OF A LONGER FILM.
Cover ONLY sentences ${first} through ${last} (inclusive). Do not plan sentences outside this range.
${w.lockedStyle
  ? `The film's style is already locked by part 1 — REUSE IT EXACTLY in your returned fields:
  northStar: ${w.lockedStyle.northStar}
  palette: ${w.lockedStyle.palette}
  typography: ${w.lockedStyle.typography}
  texture: ${w.lockedStyle.texture}
  continuityRules: ${w.lockedStyle.continuityRules.join("; ")}`
  : "You are part 1: establish the palette, typography, texture and continuity rules the whole film will inherit."}
Visual ideas already used earlier (do NOT repeat them, keep escalating):
${w.previousShotSummaries.slice(-14).map((s) => `  - ${s}`).join("\n") || "  - none yet"}
Families of the shots immediately before this part: ${w.trailingFamilies.join(" → ") || "none"} — your first shot must not extend a run of 2.
Dark-theme shots allowed in THIS part: ${w.darkBudget}.
`
    : "";

  const prompt = `${args.repairErrors?.length ? `REPAIR THE PREVIOUS PLAN. Fix these exact issues:\n${args.repairErrors.join("\n")}\n\n` : ""}Audio duration: ${(args.durationFrames / 60).toFixed(3)}s (${args.durationFrames} frames at 60fps).
USER CREATIVE BRIEF (honor unless it conflicts with transcript truth): ${args.creativeBrief || "No extra direction; invent the most apt visual treatment from the narration."}
Reference finish guidance (inspiration only, do not reproduce): ${args.referenceStyle}
${windowBrief}
SENTENCE DIGEST (the only legal shot-boundary source):
${args.transcriptDigest.join("\n")}

WORD CUES for this range (indexes are authoritative, frames are global):
${wordTable(args.words)}

Return a complete storyboard for sentences ${first}..${last}. Use each of those sentences exactly once, contiguous and in order, starting at sentenceStartIndex ${first} and ending at sentenceEndIndex ${last}. Let the content decide how many shots that needs.`;

  // Output budget scales with the range so long films are never truncated mid-plan.
  const sentenceCount = last - first + 1;
  const estimatedShots = Math.max(2, Math.ceil(sentenceCount / 1.4));
  const maxTokens = Math.min(16000, 1200 + estimatedShots * 460);

  return structured<CreativePlanOutput>(CREATIVE_PLAN_SCHEMA, system, prompt, {
    model: getEnv().plannerModel || getEnv().model,
    temperature: 0.62,
    maxTokens,
  });
}

/** Stage 3: expand each storyboard beat into a precise art-direction/code prompt. */
export async function generateShotVisualPrompt(args: {
  shot: CreativeShotPlan;
  wordCues: WordCue[];
  filmNorthStar: string;
  continuityRules: string[];
  previousSummary: string;
  nextSummary: string;
}): Promise<ShotVisualPrompt> {
  const system = `You are a senior motion-graphics art director writing one precise visual construction prompt for a Remotion 2D animator.

AESTHETIC: Clean, broadcast-quality 2D motion graphics (1920x1080 @ 60fps).
Describe concrete 2D graphic elements:
- Floating comparison cards (light and dark cards, rounded corners, soft diffuse shadows, slight 2-3° tilt, brand badges, and inner metric tiles).
- Animated callout focus frames (vibrant coral/orange #FF5500 bounding box that pops or draws around the key metric/input price box).
- Typography layout (bold statement, kicker, tabular numbers, word-by-word reveal timing).
- Data graphs (animated SVG line stroke, ranked comparison bars, bento grid blocks, or connected node pills with traveling pulses).
- Subtle dark/light grid canvas background and gentle camera push.

CRITICAL CONSTRAINT:
DO NOT describe human anatomy, body silhouettes, mechanical robots, robotic arms, propulsion packs, or physical machinery sketches. Focus entirely on clean 2D graphic design: cards, stat tiles, callout frames, charts, typography, and node graphs.

Tie animation events to the provided local word indexes. All important motion reveals must complete by the cue's spokenEndFrame. The prompt is an instruction for a developer authoring clean Remotion React/SVG code.`;
  const prompt = `FILM NORTH STAR: ${args.filmNorthStar}
CONTINUITY RULES: ${args.continuityRules.join("; ")}
PREVIOUS SHOT VISUAL (avoid copying): ${args.previousSummary || "opening shot"}
NEXT SHOT VISUAL (set up without repeating): ${args.nextSummary || "film ending"}

SHOT STORYBOARD:
${JSON.stringify(args.shot, null, 2)}

EXACT LOCAL WORD CUES (local frames; 60fps):
${wordTable(args.wordCues)}

Write a render-ready prompt detailed enough that another model can independently code the scene without guessing.`;
  return structured<ShotVisualPrompt>(VISUAL_PROMPT_SCHEMA, system, prompt, { temperature: 0.45, maxTokens: 4500 });
}

/** Stage 4 worker: generate a distinct, complete Remotion composition for one shot. */
export async function generateRemotionShotCode(args: {
  shot: CreativeShotPlan;
  visualPrompt: ShotVisualPrompt;
  wordCues: WordCue[];
  filmContinuity: { palette: string; typography: string; texture: string; rules: string[] };
  previousSummary: string;
  nextSummary: string;
  validationError?: string;
  retryNumber?: number;
}): Promise<GeneratedCodeOutput> {
  const system = `You are an elite motion-graphics engineer and Remotion/React developer.
You author bespoke, high-precision TSX Remotion shot components for a 1920x1080 @ 60fps video engine.

VISUAL STANDARD — HIGH-END 2D TECH MOTION GRAPHICS:
Your output must look like a scene from an Apple/OpenAI keynote or premium broadcast motion graphics reel:
- Clean 2D graphic design: floating cards with rounded corners (borderRadius: 20-24), subtle borders, diffuse drop shadows, and subtle 2-3° tilt.
- Metric tiles: inner rounded boxes with small uppercase labels (letterSpacing: "0.15em") and bold tabular numbers.
- Animated callout focus frames (e.g. <mg.FocusFrame frameAt={20} color="#FF5500" borderRadius={14}> or styled border boxes) highlighting key values, pricing, or differences when the corresponding word is spoken.
- Subtle grid background: <mg.GridBackground mode="dark" /> or subtle SVG grid lines/dots on dark (#0B0D13) or light canvas.
- Staggered spring animations: cards slide up and scale in, followed by inner metric reveals, word sync, and callout focus pops.
- Data charts and bars: smooth SVG paths with <mg.Stroke> or spring-animated horizontal/vertical bar fills.
- Connected systems: rounded node badges with curved bezier paths and glowing pulse dots.

CRITICAL ANTI-PATTERN:
- STRICTLY FORBIDDEN: DO NOT draw human silhouettes, bodies, limbs, or faces.
- STRICTLY FORBIDDEN: DO NOT attempt complex mechanical drawings (robotic arms, gear assemblies, backpacks, machinery) using SVG paths.
Always compose with clean 2D UI cards, metric slabs, callout boxes, typography, charts, and node networks.

OUTPUT RULES & COMPILATION CONTRACT:
1. IMPORTS: Include only these exact imports:
   import React from "react";
   import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, interpolate, spring, Easing, random, Img } from "remotion";
   import { mg } from "@frame60/mg";

2. EXPORT: Exactly one exported component named GeneratedShot:
   export const GeneratedShot = (props) => { ... };
   props receives: { shotPlan, visualPrompt, wordCues, continuity, assets }

3. REMOTION HOOKS & TIMING:
   - Must call:
     const frame = useCurrentFrame();
     const { fps, width, height, durationInFrames } = useVideoConfig();
     const cues = props.wordCues || [];
   - Frame timing is local to this shot (starts at frame 0).
   - Motion must be driven mathematically from frame using interpolate(frame, [start, end], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) or spring().
   - Never use CSS keyframe animations, CSS transitions, setTimeout, setInterval, Date, or Math.random (use Remotion random(seed)).

4. AVAILABLE @frame60/mg PRIMITIVES:
   - <mg.GridBackground mode="dark" /> : subtle grid lines on dark/light canvas
   - <mg.FocusFrame frameAt={20} color="#FF5500" borderRadius={14}>{children}</mg.FocusFrame> : animated callout focus box (alias: <mg.Callout>)
   - <mg.WordCue cue={cue} emphasis={boolean} emphasisColor="#0066FF">{cue.text}</mg.WordCue> : voice-synced word reveal with subtle rise and blur
   - <mg.CueProgress cue={cue} width={240} color="#0066FF" /> : progress bar synced to word spoken duration
   - <mg.Roll to={number} from={0} fontSize={90} color="#fff" /> : animated rolling numeral
   - <mg.Stroke d="M..." width={w} height={h} color="#0066FF" durationFrames={45} /> : trim-path animated SVG path (alias: mg.Sweep)
   - <mg.CameraRig zoom={1.03} x={0} y={0}>{children}</mg.CameraRig> : camera pan/push container
   - <mg.ImpactLine text="Headline" frameAt={0} size={72} color="#fff" /> : bold kinetic text slam
   - <mg.Marker x={100} y={100} color="#0066FF" variant="cross" /> : architectural crosshair/dot marker
   - <mg.Noise opacity={0.035} /> : subtle procedural texture overlay

5. ALLOWED TAGS & ATTRIBUTES:
   - Standard SVG: <svg>, <g>, <path>, <rect>, <circle>, <ellipse>, <line>, <polyline>, <polygon>, <defs>, <marker>, <linearGradient>, <radialGradient>, <clipPath>, <mask>, <text>, <tspan>, <pattern>, <symbol>, <use>, <metadata>, <title>, <desc>
   - Standard HTML text: <div>, <span>, <p>, <h1>..<h6>, <code>, <pre>, <strong>, <em>, <ul>, <ol>, <li>
   - Absolutely NO external URLs (no http:// or https:// image links; render all visuals with SVG paths, gradients, shapes, or typography).
   - Absolutely NO browser globals: no window, document, fetch, localStorage, WebSocket, eval.

6. DESIGN & COMPOSITION RECIPES:
   - Comparison Cards: Two floating cards (e.g. Card 1 white/light with model/product badge, Card 2 dark with competing model badge). Staggered entrance, subtle rotation (-2.5deg and +2deg), metric rows (context, input, output), and an animated coral/orange callout frame around the highlighted figure.
   - Data & Bar Comparisons: Clean horizontal/vertical metric bars filling smoothly with spring physics, percentage tags, and stat callouts.
   - Kinetic Hero: Giant typography slam with voice-synced <mg.WordCue> reveals and rolling count-up numbers.
   - Connected Systems: Clean pill/box nodes connected with curved bezier lines and animated traveling pulse dots.
   - Return clean, valid TypeScript JSX. No markdown backticks inside the sourceCode string property.`;
  const prompt = `${args.validationError ? `RETRY ${args.retryNumber ?? 1}. The previous component failed validation. Fix the exact error below; keep the art direction, do not simplify to a template:\n${args.validationError}\n\n` : ""}FILM CONTINUITY KIT:
${JSON.stringify(args.filmContinuity, null, 2)}

PREVIOUS SHOT (composition to differ from): ${args.previousSummary || "opening"}
NEXT SHOT (avoid anticipating its exact composition): ${args.nextSummary || "ending"}

PLANNER SHOT:
${JSON.stringify(args.shot, null, 2)}

PRECISE VISUAL PROMPT:
${JSON.stringify(args.visualPrompt, null, 2)}

WORD CUES:
${JSON.stringify(args.wordCues)}

Return a fully authored Remotion TSX module in sourceCode. The visualSummary should describe the rendered composition (not the prompt); designChoices should list 3-6 distinctive visual decisions.`;
  return structured<GeneratedCodeOutput>(GENERATED_CODE_SCHEMA, system, prompt, {
    temperature: 0.2,
    maxTokens: 7500,
  });
}
