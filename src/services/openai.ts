// src/services/openai.ts
// OpenAI & AgentRouter SDK wrapper — all LLM calls go through here.
// Reads config from env service, supports custom baseURL/model via .env or Settings UI.
// Supports both OpenAI /v1/chat/completions and AgentRouter /v1/responses.

import OpenAI from "openai";
import { getEnv, hasValidKey, getEffectiveBaseURL, isAgentRouter, OpenAIEnv } from "./env";
import type { ShotPlanJSON } from "../sdk/contract.pipeline";
import type {
  CreativePlanOutput,
  CreativeShotPlan,
  GeneratedCodeOutput,
  ShotVisualPrompt,
  WordCue,
  EntityAnalysisOutput,
  EntityImageRequirement,
  UploadedImageAsset,
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
    timeout: 120000,
    maxRetries: 2,
    dangerouslyAllowBrowser: true, // required for client-side usage — key is user-owned
    defaultHeaders: isAgentRouter() ? AGENTROUTER_HEADERS : undefined,
  });
  _clientKey = key;
  return _client;
}

export function resetClient() {
  _client = null;
  _clientKey = null;
}

/**
 * Unified endpoint connection tester:
 * - AgentRouter ONLY accepts /v1/responses (OpenAI Responses API) with CLI headers
 * - HCNSEC / Standard OpenAI accepts /v1/chat/completions
 */
export async function testEndpointConnection(targetEnv: OpenAIEnv, isRoute1?: boolean): Promise<{ ok: boolean; msg: string }> {
  if (!targetEnv.apiKey || targetEnv.apiKey.trim().length < 5) {
    throw new Error("API Key is missing or too short.");
  }

  const isAgent = isRoute1 ?? ((targetEnv.baseURL || "").toLowerCase().includes("agentrouter.org") || isAgentRouter(targetEnv));

  if (isAgent) {
    let effectiveBase = targetEnv.baseURL || "https://agentrouter.org/v1";
    effectiveBase = effectiveBase.replace(/\/+$/, "");
    if (!effectiveBase.endsWith("/v1")) effectiveBase = `${effectiveBase}/v1`;

    if (typeof window !== "undefined" && effectiveBase.includes("agentrouter.org")) {
      effectiveBase = `${window.location.origin}/agentrouter-proxy/v1`;
    }

    const endpoint = `${effectiveBase}/responses`;
    console.log(`[Test Connection] Testing AgentRouter via ${endpoint} with model ${targetEnv.model}`);

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${targetEnv.apiKey}`,
        "Content-Type": "application/json",
        ...AGENTROUTER_HEADERS,
      },
      body: JSON.stringify({
        model: targetEnv.model || "gpt-6-astra",
        input: [{ role: "user", content: "ping" }],
        max_tokens: 15,
        reasoning_effort: "none",
        thinking: { type: "disabled" },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      let errJson: any = null;
      try { errJson = JSON.parse(errText); } catch {}
      const msg = errJson?.error?.message || errText || `HTTP ${res.status}`;
      return { ok: false, msg };
    }

    const data = await res.json();
    if (data?.error) {
      return { ok: false, msg: data.error.message || JSON.stringify(data.error) };
    }

    return {
      ok: true,
      msg: `Connected to ${targetEnv.baseURL} via /v1/responses — model "${targetEnv.model || "gpt-6-astra"}" responded OK!`,
    };
  } else {
    let effectiveBase = targetEnv.baseURL || "https://api.openai.com/v1";
    effectiveBase = effectiveBase.replace(/\/+$/, "");
    if (!effectiveBase.endsWith("/v1")) effectiveBase = `${effectiveBase}/v1`;

    console.log(`[Test Connection] Testing OpenAI/HCNSEC via ${effectiveBase}/chat/completions with model ${targetEnv.model}`);
    const client = new OpenAI({
      apiKey: targetEnv.apiKey,
      baseURL: effectiveBase,
      dangerouslyAllowBrowser: true,
    });

    try {
      await client.models.list();
    } catch {
      // Some proxies disable /v1/models; proceed to completion probe
    }

    const completion = await client.chat.completions.create({
      model: targetEnv.model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 15,
    });

    const reply = completion.choices[0]?.message?.content || "OK";
    return {
      ok: true,
      msg: `Connected to ${targetEnv.baseURL} via /v1/chat/completions — model "${targetEnv.model}" responded OK! (${reply.slice(0, 40).trim()})`,
    };
  }
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

  // 1. If wrapped in markdown code fence, extract inside fence
  const fenceMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch && fenceMatch[1]) {
    clean = fenceMatch[1].trim();
  }

  // 2. Locate first '{' and last '}'
  const firstBrace = clean.indexOf("{");
  const lastBrace = clean.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    clean = clean.substring(firstBrace, lastBrace + 1);
  } else {
    throw new Error(`No JSON object found in model output: ${clean.slice(0, 150)}`);
  }

  try {
    return JSON.parse(clean) as T;
  } catch (e) {
    throw new Error(`Invalid JSON syntax: ${(e as Error).message}\nOutput: ${clean.slice(0, 300)}`);
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

  const tokenLimit = maxOutputTokens || env.maxOutputTokens || 32768;
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
        } catch { }
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

      if (attempt < maxAttempts) {
        const isRateLimit = /rate limit|exceeded.*rate limit|tokens per minute|tpm|rpm|too many requests|429/i.test(errMsg);
        const isTransient = /unreachable|empty response|500|502|503|504|ECONNRESET|fetch failed/i.test(errMsg);
        let waitMs: number;
        if (isRateLimit) {
          // Token rate limits (TPM) need time to replenish tokens; back off with jitter
          waitMs = Math.min(35000, 8000 * attempt + Math.floor(Math.random() * 2500));
          onLog(`[Rate Limit] Token quota exceeded on model gateway. Cooling down for ${(waitMs / 1000).toFixed(1)}s before retry ${attempt + 1}/${maxAttempts}...`);
        } else if (isTransient) {
          waitMs = Math.max(3000, 2000 * attempt);
          onLog(`[AgentRouter] Attempt ${attempt} transient network error: ${errMsg}. Retrying in ${(waitMs / 1000).toFixed(1)}s...`);
        } else {
          waitMs = 1500 * attempt;
          onLog(`[AgentRouter] Attempt ${attempt} failed: ${errMsg}. Retrying in ${(waitMs / 1000).toFixed(1)}s...`);
        }
        await sleep(waitMs);
        continue;
      }
      onLog(`[AgentRouter] Attempt ${attempt} failed: ${errMsg}`);
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

  if (isAgentRouter()) {
    const raw = await sendAgentRouterRequest({
      model,
      systemInstruction: systemPrompt,
      prompt: userPrompt,
      responseJsonSchema: SHOTPLAN_SCHEMA.schema,
      maxOutputTokens: env.maxOutputTokens || 32768,
      onLog: onProgress,
    });
    const parsed = parseJsonOutput<ShotPlanJSON>(raw);
    onProgress?.(`Planner complete — ${parsed.shots?.length ?? 0} shots generated`);
    return parsed;
  }

  const client = getClient();
  if (!client) throw new Error("OpenAI API key not configured. Set VITE_OPENAI_API_KEY in .env or via Settings.");

  console.log(`[Planner LLM] Calling ${getEffectiveBaseURL()} with model ${model}`);
  let content: string | null | undefined;
  try {
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
      max_tokens: env.maxOutputTokens || 32768,
    });

    const msg = completion.choices[0]?.message as any;
    content = msg?.content || msg?.reasoning_content;
  } catch (schemaErr) {
    const schemaErrMsg = (schemaErr as Error).message || "";
    if (/response_format|json_schema|unsupported|not supported|schema/i.test(schemaErrMsg)) {
      console.log(`[Planner LLM] json_schema rejected, falling back to json_object on ${getEffectiveBaseURL()}`);
      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: `${systemPrompt}\n\nReturn strictly valid JSON matching this schema:\n${JSON.stringify(SHOTPLAN_SCHEMA.schema)}` },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
        max_tokens: env.maxOutputTokens || 32768,
      });
      const msg = completion.choices[0]?.message as any;
      content = msg?.content || msg?.reasoning_content;
    } else {
      throw schemaErr;
    }
  }

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
    if (isAgentRouter()) {
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
    console.log(`[ASR Cleanup] Calling ${getEffectiveBaseURL()} with model ${env.model}`);
    const res = await client.chat.completions.create({
      model: env.model,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });
    const msg = res.choices[0]?.message as any;
    const rawContent = msg?.content || msg?.reasoning_content || "{}";
    const parsed = JSON.parse(rawContent);
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
            assignedAssets: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  assetId: { type: "string" },
                  standardizedFilename: { type: "string" },
                  status: { type: "string", enum: ["provided", "missing_fallback"] },
                  role: { type: "string" },
                  placement: { type: "string" },
                },
                required: ["assetId", "standardizedFilename", "status", "role", "placement"],
                additionalProperties: false,
              },
            },
          },
          required: [
            "shotId", "sentenceStartIndex", "sentenceEndIndex", "spokenText", "cleanedDisplaySentences",
            "purpose", "visualIdea", "keyEvidence", "emphasisWordIndices", "visualFamily", "themeMode",
            "energy", "transitionIn", "transitionDirection", "continuityNote", "assignedAssets",
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

  if (isAgentRouter()) {
    const raw = await sendAgentRouterRequest({
      model,
      systemInstruction: system,
      prompt,
      responseJsonSchema: schema.schema,
      temperature: null,
      maxOutputTokens: options.maxTokens ?? env.maxOutputTokens ?? 32768,
      maxAttempts: 5,
    });
    return parseJsonOutput<T>(raw);
  }

  const client = getClient();
  if (!client) throw new Error("OpenAI client initialization failed.");

  // Respect requested options.maxTokens or env.maxOutputTokens without artificial downward clamps
  const requestedCap = Math.max(options.maxTokens ?? 0, env.maxOutputTokens ?? 0) || 32768;
  let currentMaxTokens = Math.max(8192, requestedCap);
  let lastError: Error | null = null;
  let lastRawOutput = "";

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      console.log(`[Structured Request] Calling ${getEffectiveBaseURL()} with model ${model} (${schema.name}) attempt ${attempt}/4 with max_tokens=${currentMaxTokens}`);

      // If previous attempt returned invalid JSON or malformed response, send it right back with fix instructions!
      let userPrompt = prompt;
      if (attempt > 1 && lastError) {
        console.warn(`[Structured Request] Attempt ${attempt - 1} produced invalid output. Sending repair request to model...`);
        userPrompt = `${prompt}

[CRITICAL INSTRUCTION - PREVIOUS ATTEMPT FAILED WITH INVALID JSON]:
Your previous attempt failed with error: ${lastError.message}
${lastRawOutput ? `Your previous output began with: ${lastRawOutput.slice(0, 250)}...` : ""}

YOU MUST FIX THIS NOW:
1. Return ONLY valid, complete JSON matching the required schema.
2. The response MUST start with '{' and end with '}'.
3. Do NOT include ANY chain-of-thought, thinking, reasoning, explanation, or conversational markdown outside the JSON.
4. Ensure all brackets, braces, and quotes are closed and strictly valid JSON syntax.`;
      }

      let content: string | null | undefined;
      try {
        const stream = await client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: `${system}\n\n[DIRECTIVE: Output strictly valid JSON. Start with { and end with }.]` },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_schema", json_schema: schema as never },
          temperature: attempt === 1 ? (options.temperature ?? 0.55) : 0.2,
          max_tokens: currentMaxTokens,
          stream: true,
        });
        let streamedContent = "";
        let streamedReasoning = "";
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta as any;
          if (delta?.content) streamedContent += delta.content;
          if (delta?.reasoning_content) streamedReasoning += delta.reasoning_content;
        }
        content = streamedContent || streamedReasoning;
      } catch (schemaErr) {
        const schemaErrMsg = (schemaErr as Error).message || "";
        // If the provider doesn't support json_schema, fallback to json_object
        if (/response_format|json_schema|unsupported|not supported|schema/i.test(schemaErrMsg)) {
          console.log(`[Structured Request] json_schema rejected, falling back to json_object on ${getEffectiveBaseURL()}`);
          const stream = await client.chat.completions.create({
            model,
            messages: [
              { role: "system", content: `${system}\n\nSTRICT JSON CONTRACT: Return ONLY valid JSON matching this schema:\n${JSON.stringify(schema.schema)}` },
              { role: "user", content: userPrompt },
            ],
            response_format: { type: "json_object" },
            temperature: attempt === 1 ? (options.temperature ?? 0.55) : 0.2,
            max_tokens: currentMaxTokens,
            stream: true,
          });
          let streamedContent = "";
          let streamedReasoning = "";
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta as any;
            if (delta?.content) streamedContent += delta.content;
            if (delta?.reasoning_content) streamedReasoning += delta.reasoning_content;
          }
          content = streamedContent || streamedReasoning;
        } else {
          throw schemaErr;
        }
      }

      if (!content || !content.trim()) {
        throw new Error("The model returned an empty response.");
      }

      lastRawOutput = content;
      return parseJsonOutput<T>(content);
    } catch (err) {
      lastError = err as Error;
      const msg = lastError.message || "";
      const isRateLimit = /rate limit|quota|429/i.test(msg);

      // Bump token headroom on retry in case truncation caused invalid JSON (never clamp down to 10k)
      currentMaxTokens = Math.min(100000, currentMaxTokens + 8000);

      if (attempt < 4) {
        const wait = isRateLimit ? 5000 * attempt : 1500 * attempt;
        console.warn(`[Structured Request] Attempt ${attempt} failed (${msg.slice(0, 100)}). Retrying with fix instructions in ${wait}ms...`);
        await sleep(wait);
        continue;
      }
      throw new Error(`Model structured response failed after 4 attempts: ${msg}\nOutput snippet: ${lastRawOutput.slice(0, 300)}`);
    }
  }
  throw new Error("Failed to receive structured response.");
}

const ENTITY_ANALYSIS_SCHEMA = {
  name: "entity_analysis",
  strict: true,
  schema: {
    type: "object",
    properties: {
      overallVisualTheme: { type: "string" },
      entities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Clean lowercase snake_case identifier, e.g. king_baldwin, elon_musk" },
            name: { type: "string", description: "Human-readable entity title, e.g. King Baldwin IV" },
            targetFilename: { type: "string", description: "Canonical filename prefix without extension, e.g. king_baldwin" },
            category: {
              type: "string",
              enum: ["person", "historical", "product", "organization", "location", "object"],
            },
            rationale: { type: "string", description: "Why an image of this entity is critical for video presentation" },
            suggestedFraming: {
              type: "string",
              enum: ["portrait", "landscape", "square", "transparent_cutout"],
            },
            recommendedResolution: { type: "string" },
            importance: {
              type: "string",
              enum: ["essential", "recommended", "optional"],
            },
            sentenceIndices: {
              type: "array",
              items: { type: "integer" },
            },
            cleverFallbackIdea: {
              type: "string",
              description: "Clever motion graphic alternative if user provides no image (e.g. regal monogram, heraldic seal, dossier card, vector cartography)",
            },
          },
          required: ["id", "name", "targetFilename", "category", "rationale", "suggestedFraming", "importance", "sentenceIndices", "cleverFallbackIdea"],
          additionalProperties: false,
        },
      },
    },
    required: ["entities"],
    additionalProperties: false,
  },
} as const;

/**
 * Phase 1.5: Analyze transcript to extract key entities requiring images for presentation.
 * Returns required entities with canonical target filenames and clever fallback ideas.
 */
export async function analyzeTranscriptEntities(args: {
  transcript: string;
  sentences: Array<{ index: number; text: string; start?: number; end?: number }>;
  creativeBrief?: string;
  onProgress?: (msg: string) => void;
}): Promise<EntityImageRequirement[]> {
  const system = `You are an elite motion-graphics archival researcher and visual director for documentary and explainer videos (1920x1080 @ 60fps).
Your mission: Analyze the narration transcript completely and identify real-world ENTITIES that drastically elevate the viewer's understanding and visual engagement if photographic/illustrative images are provided.

TARGET ENTITIES TO DETECT:
1. Historical & Prominent Figures: Kings, emperors, generals, scientists, politicians, CEOs (e.g. King Baldwin IV, Saladin, Elon Musk, Bill Gates, Oppenheimer).
2. Iconic Products & Inventions: Specific hardware, vehicles, spacecraft, architectural landmarks, flagship gadgets (e.g. Apple Vision Pro, SR-71 Blackbird, Falcon 9).
3. Institutions & Organizations: Specific companies, agencies, kingdoms, empires, dynasties (e.g. Kingdom of Jerusalem, NASA, DeepMind).
4. Critical Historical Documents & Artifacts: Treaties, maps, paintings, relics (e.g. Magna Carta, Silver Mask of Baldwin).

CRITICAL DIRECTIVES:
- Only flag tangible entities where a real visual image (portrait, photograph, historical illustration, official logo) makes the audience say: "Yes! Now I see who/what we are listening to."
- Do NOT flag abstract generic concepts (do not flag "money", "freedom", "success", "future", "war").
- Generate a canonical slug for 'id' and 'targetFilename' using strictly lowercase letters, numbers, and underscores (e.g. 'king_baldwin', 'elon_musk').
- For 'suggestedFraming', select the most natural aspect ratio for this entity:
  - 'portrait': ideal for individual human figures, monarchs, executives.
  - 'landscape': ideal for locations, battles, vehicles, wide landscapes.
  - 'square': ideal for profile tokens, products, emblems.
  - 'transparent_cutout': ideal for objects, devices, cut-out character stills.
- For 'cleverFallbackIdea': Images are 100% OPTIONAL for the user. Therefore, define a clever, creative motion graphics backup design (e.g. regal serif monogram with roman numerals, vector heraldic seal, classified dossier card with redacted callout, or cartographic pin) in case the user does not upload an image!`;

  const sentenceDigest = args.sentences
    .map((s) => `[S${s.index}] ${s.text}`)
    .join("\n");

  const prompt = `TRANSCRIPT DIGEST:
${sentenceDigest}

${args.creativeBrief ? `CREATIVE BRIEF:\n${args.creativeBrief}\n` : ""}

Identify all visual entities in this transcript that would benefit from imagery. Produce the structured entity requirements list.`;

  args.onProgress?.("Analyzing transcript for visual entity image requirements...");
  const result = await structured<EntityAnalysisOutput>(ENTITY_ANALYSIS_SCHEMA, system, prompt, {
    temperature: 0.3,
    maxTokens: 4000,
  });

  const cleaned = (result.entities || []).map((e) => {
    const safeSlug = (e.id || e.targetFilename || e.name || "entity")
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return {
      ...e,
      id: safeSlug || `entity_${Math.random().toString(36).slice(2, 6)}`,
      targetFilename: safeSlug || `entity_${Math.random().toString(36).slice(2, 6)}`,
      name: e.name || safeSlug,
      category: e.category || "person",
      suggestedFraming: e.suggestedFraming || "portrait",
      importance: e.importance || "recommended",
      sentenceIndices: Array.isArray(e.sentenceIndices) ? e.sentenceIndices : [],
      cleverFallbackIdea: e.cleverFallbackIdea || "Regal serif monogram and stylized vector heraldic emblem",
    };
  });

  return cleaned;
}

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
  totalFilmSeconds?: number;
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
  availableAssets?: UploadedImageAsset[];
  entityRequirements?: EntityImageRequirement[];
}): Promise<CreativePlanOutput> {
  const system = `You are the CREATIVE DIRECTOR and MOTION GRAPHICS SUPERVISOR for a bespoke Remotion 2D animated film (1920x1080 @ 60fps).
BENCHMARK: Premium documentary, thriller, and explainer channels (Vox, Johnny Harris, Magnates Media, ColdFusion, Bloomberg Quicktake).

PRIMARY VISUAL AESTHETIC — CINEMATIC EXPLAINER & DOCUMENTARY MOTION DESIGN:
- Every single scene MUST feature a LARGE, PROMINENT ANIMATED VISUAL STAGE or HERO COMPONENT occupying 65% to 85% of the 1920x1080 canvas.
- Text is supporting copy ONLY (a compact 1-line headline + kicker at top-left).
- Dynamic camera choreography: POV zoom-in, tracking pan along trajectory/graph, and zoom-out context reveals.
- STRICT BAN ON TEXT-ONLY SCENES: NEVER plan a scene that only displays text, titles, paragraphs, bullet points, quotes, or spoken word dumps in the center of the frame. Spoken words belong in the audio track and in a compact 1-line top-left headline. The center of the frame MUST be occupied by an active visual explanation (trajectory chart, comparison cards, connected system conduits, bento metric matrix, or geographic map) that visually explains what is being said.

DYNAMIC SCENE COUNT & PACING (BROADCAST MOTION GRAPHICS STANDARD):
- Shot count MUST scale with the audio duration (7 to 11 seconds per scene):
  - ~30 seconds of audio -> 3 to 4 scenes
  - ~60 seconds (1 min) -> 6 to 8 scenes
  - ~120 seconds (2 mins) -> 12 to 15 scenes
  - ~240 seconds (4 mins) -> 24 to 28 scenes
  - ~480 seconds (8 mins) -> 48 to 56 scenes
- Target 7 to 11 seconds per scene: snappy, broadcast-quality motion graphics pacing matching the demo reel (never drag beyond 14s unless a single long sentence).

─── VISUAL COMPLEMENTATION DIRECTIVE (CRITICAL — PLAN WHAT TO SHOW) ───
For EVERY shot, you MUST ask: "What visual will make the viewer UNDERSTAND this narration point better than just hearing it?"
Your 'visualIdea' field MUST include a "BECAUSE ..." justification explaining WHY this visual helps the viewer understand.

CONTENT-TO-VISUAL MAPPING PATTERNS (use the best match):
- Numbers, statistics, money amounts → Rolling counter slabs, bar charts, metric dossiers, percentage rings
  Example: "Revenue hit $12B" → Kinetic hero with giant ghost numeral 12 and expanding capsule with <mg.Roll> BECAUSE the viewer needs to feel the scale of the number
- Comparisons (old vs new, before/after, A vs B) → Dual comparison cards side-by-side with differential deltas
  Example: "The old model vs the new one" → Two floating glassmorphic cards with feature rows BECAUSE side-by-side contrast makes the difference instantly clear
- Processes, systems, pipelines, supply chains → Connected node mesh with traveling glow packets
  Example: "Data flows from servers to users" → 6-node connected mesh with bezier flow lines BECAUSE the viewer needs to see how components connect
- Growth, decline, trajectory, history → Trajectory chart with camera following the curve
  Example: "Amazon was at its peak, then crashed" → SVG trajectory chart, camera zoomed into peak, follows descent, zooms out to show full history BECAUSE the viewer needs to see the shape of the journey
- Concrete entities (companies, products, tech, vehicles) → Iconic badge/emblem/silhouette on a spatial stage
  Example: "The Arc Reactor powers the suit" → Clean Arc Reactor emblem glowing inside a HUD reticle BECAUSE the viewer needs to see what is being described
- International travel, transatlantic/pacific journeys, geopolitics, global trade, corporate expansion, supply chains → Pre-built world map (<mg.MapStage>) with animated parabolic route (<mg.MapRoute>), city beacons (<mg.MapCity>), and country highlights (<mg.MapHighlight>)
  Example: "From the UK to America, the expansion began" → <mg.MapStage> tracking a glowing transatlantic arc from London to New York with country highlights BECAUSE the viewer needs spatial geography to grasp distance and international scale
- Lists, features, capabilities → Bento grid of metric slabs with staggered reveals
  Example: "It has weapons, flight, armor, and sensors" → 4 bento metric slabs with icons staggering in BECAUSE the viewer needs to see each capability individually
- Questions, searches, investigations → Terminal/query trace with cascading result cards
  Example: "Why did this fail?" → Search terminal typing the question, result cards cascading below BECAUSE it mirrors the investigative tone
- Cause and effect, dependencies → Flow diagram or timeline with milestone markers
  Example: "Because batteries are heavy, flight time is limited" → Timeline with battery weight milestone leading to flight-time bar BECAUSE causality needs sequential visual proof
- Abstract ideas, themes, moods → Atmospheric kinetic typography with spatial depth (giant ghost text, expanding capsules)
  Example: "Imagine the possibilities" → Giant ghost numeral with drifting kinetic text BECAUSE pure atmosphere carries abstract mood better than forced illustrations

MANDATORY HERO COMPONENT ARCHETYPES (Plan one for every shot's 'visualIdea'):
1. [Trajectory & Camera Follow]: 1400px SVG graph path / area chart with dynamic camera POV zoom into peak, camera follows the entity badge along its descent/trajectory, zoom-out reveals full graph context, secondary symbols (money/currency $ signs, injection flow, rescue markers) flow into entity.
2. [Dual Comparison Board]: 2 large floating glassmorphic comparison cards (width: 700px each) comparing models, eras, or options with brand badges, metric rows, and an animated coral focus frame (<mg.FocusFrame>).
3. [Ranked Bar / Milestone Timeline]: Baseline line with 3-4 thick vertical bars or milestone date pillars shooting up with spring physics, rolling numbers atop each bar (<mg.Roll>), and winner singled out.
4. [System & Capital Flow Mesh]: 6-8 system/pipeline node pills linked by curved bezier lines with glowing traveling pulse packets and sonar pulse rings.
5. [Bento Metric Dossier]: 3-4 structured large metric slabs filling the frame with rolling counters (<mg.Roll>), percentage rings, and status tags.
6. [Query & Inspection Trace]: Search/terminal input typing out query character-by-character with 3-4 cascading result cards, or dossier table with floating magnifier reticle.
7. [Bespoke Iconic Entity Graphic]: When a company, vehicle, currency, hardware, or subject is discussed (Amazon, plane, helicopter, Iron Man arc reactor / armor tech, battery, chip, dollar/money, server):
   CRITICAL RULE: DO NOT plan complex anatomical humanoid drawings (no multi-joint finger/knee bezier meshes). Instead, plan an ICONIC, HIGH-IMPACT VECTOR BADGE, EMBLEM, SILHOUETTE, or SCHEMATIC with motion telemetry, glowing HUD rings, and dynamic camera choreography.
8. [Geographic Map & Tactical Route]: When international travel, flights, global trade, corporate expansion, military movements, or international infrastructure are discussed (e.g. from UK to America, across the Atlantic/Pacific, Asian manufacturing to US market):
   CRITICAL RULE: DO NOT attempt to draw raw geographic map SVG paths by hand. Use the built-in <mg.MapStage> vector cartography suite with dynamic camera tracking along flight arcs (<mg.MapRoute from="..." to="...">), pulsing sonar city beacons (<mg.MapCity name="...">), and country isolation glows (<mg.MapHighlight country="...">).

SELECTIVE & PURPOSEFUL SVG USAGE DIRECTIVE (CRITICAL):
- DO NOT force an SVG into every shot. SVGs must be used SELECTIVELY and PURPOSEFULLY: only when visually showing the concrete object or symbol directly anchors the core narrative point (e.g. showing an Amazon logo at the peak of a graph, or an Arc Reactor / battery pack when explaining the physical energy constraint, or money/dollar signs when explaining funding).
- Target a balanced rhythm: approximately 1 out of every 2 or 3 shots (~30–40%) features a hero illustrative vector SVG/emblem to ground the narrative meaning.
- The remaining 60–70% of shots MUST rely on clean, elegant motion graphics:
  - Trajectory / line charts showing performance and trends
  - Split comparison boards (Old vs New, Light vs Dark, Option A vs B)
  - Bento metric grids and KPI slabs with rolling numerals (<mg.Roll>)
  - Connected system flow conduits with traveling pulse packets
  - Ranked milestone bar charts and timelines
  - Terminal inspection and query dossiers
- Never force an SVG for abstract concepts or minor incidental words. Only use an SVG when it gives the viewer immediate, unambiguous clarity on what is being discussed.
- When an SVG is used, keep it clean and iconic (e.g. 5–15 clean SVG elements, recognizable silhouette or emblem) — just enough visual detail so the viewer immediately grasps the complete meaning without visual clutter or anatomical distortion.

WORD ALIGNMENT IS SACRED:
Use global word indices for emphasis. Never invent or rewrite the spoken transcript. Never output float timestamps. Shot boundaries are sentence indices only.

NARRATIVE RULES:
- All sentences covered exactly once, in order, without overlap or gaps.
- Diverse visual families across the acts.
- No adjacent repeat of the same visualFamily; no more than 2 consecutive shots from the same family.
- Every shot's 'visualIdea' MUST state the component archetype, what large animated visual component is shown, and include "BECAUSE ..." explaining why this visual complements the narration.`;

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

  const partDurationSec = (args.durationFrames / 60).toFixed(1);
  const totalFilmSec = (w?.totalFilmSeconds ?? args.durationFrames / 60).toFixed(1);
  const durationText = w
    ? `Part ${w.index + 1} of ${w.total}: speech duration ${partDurationSec}s (Total film: ${totalFilmSec}s).`
    : `Audio duration: ${partDurationSec}s (${args.durationFrames} frames at 60fps).`;

  let assetContext = "";
  if ((args.availableAssets && args.availableAssets.length > 0) || (args.entityRequirements && args.entityRequirements.length > 0)) {
    const uploaded = args.availableAssets || [];
    const reqs = args.entityRequirements || [];
    const lines: string[] = ["─── ENTITY IMAGE ASSETS STATUS & CHOREOGRAPHY DIRECTIVES ───"];
    if (uploaded.length > 0) {
      lines.push("AVAILABLE UPLOADED IMAGE ASSETS:");
      for (const a of uploaded) {
        lines.push(`• [UPLOADED] ${a.standardizedFilename}: "${a.entityName}" (${a.width}×${a.height}, ${a.aspectRatioLabel})`);
      }
      lines.push("DIRECTIVE FOR UPLOADED ASSETS: In shots where these entities are discussed, you MUST prominently feature their image! Adapt the spatial layout to the real aspect ratio (e.g. portrait in left/right half, or center hero portrait with cinematic vignette). Include the asset filename in your visualIdea and assignedAssets array.");
    }
    const missing = reqs.filter((r) => !uploaded.some((u) => u.id === r.id || u.standardizedFilename.startsWith(r.targetFilename)));
    if (missing.length > 0) {
      lines.push("\nMISSING ASSETS (NO IMAGE PROVIDED BY USER):");
      for (const m of missing) {
        lines.push(`• [NO IMAGE] "${m.name}" (Slug: ${m.targetFilename}, Sentences: ${m.sentenceIndices.join(", ")})`);
        lines.push(`  Clever Alternative: ${m.cleverFallbackIdea}`);
      }
      lines.push("DIRECTIVE FOR MISSING ASSETS (CRITICAL): The user did NOT provide images for these entities. NEVER plan generic bullet points or text dumps. Be CLEVER with the presentation: plan high-energy stylized motion graphics such as a regal serif monogram with roman numerals, an animated SVG heraldic seal/emblem via <mg.Stroke>, an archival dossier slab with redacted bars, or a dynamic coordinate beacon on <mg.MapStage>!");
    }
    assetContext = "\n" + lines.join("\n") + "\n";
  }

  const prompt = `${args.repairErrors?.length ? `REPAIR THE PREVIOUS PLAN. Fix these exact issues:\n${args.repairErrors.join("\n")}\n\n` : ""}${durationText}
USER CREATIVE BRIEF (honor unless it conflicts with transcript truth): ${args.creativeBrief || "No extra direction; invent the most apt visual treatment from the narration."}
Reference finish guidance (inspiration only, do not reproduce): ${args.referenceStyle}
${windowBrief}
${assetContext}
SENTENCE DIGEST (the only legal shot-boundary source; use words:start..end ranges for emphasisWordIndices):
${args.transcriptDigest.join("\n")}

Return a complete storyboard for sentences ${first}..${last}. Use each of those sentences exactly once, contiguous and in order, starting at sentenceStartIndex ${first} and ending at sentenceEndIndex ${last}. Let the content decide how many shots that needs.`;

  // Output budget scales with the range so long films are never truncated mid-plan.
  const sentenceCount = last - first + 1;
  const estimatedShots = Math.max(2, Math.ceil(sentenceCount / 1.5));
  const maxTokens = Math.min(24000, 6000 + estimatedShots * 350);

  return structured<CreativePlanOutput>(CREATIVE_PLAN_SCHEMA, system, prompt, {
    model: getEnv().plannerModel || getEnv().model,
    temperature: 0.62,
    maxTokens,
  });
}

/** Helper to format word cues concisely to save 85%+ prompt tokens */
function formatCompactWordCues(words: WordCue[]): string {
  return words.map((w) => `[W${w.wordIndex} f${w.startFrame}-${w.spokenEndFrame} "${w.text}"]`).join(" ");
}

/** Stage 3: expand each storyboard beat into a precise art-direction/code prompt. */
export async function generateShotVisualPrompt(args: {
  shot: CreativeShotPlan & { durationFrames?: number };
  wordCues: WordCue[];
  filmNorthStar: string;
  continuityRules: string[];
  previousSummary: string;
  nextSummary: string;
  availableAssets?: UploadedImageAsset[];
  entityRequirements?: EntityImageRequirement[];
}): Promise<ShotVisualPrompt> {
  const durationFrames = args.shot.durationFrames ?? (args.wordCues.length ? Math.max(120, args.wordCues.at(-1)!.spokenEndFrame + 30) : 180);
  const matchingAsset = (args.availableAssets || []).find((a) =>
    args.shot.visualIdea?.includes(a.standardizedFilename) ||
    args.shot.assignedAssets?.some((as) => as.standardizedFilename === a.standardizedFilename) ||
    args.shot.visualIdea?.toLowerCase().includes(a.entityName.toLowerCase()) ||
    args.shot.spokenText.toLowerCase().includes(a.entityName.toLowerCase())
  );
  const matchingMissing = (args.entityRequirements || []).find((r) =>
    !matchingAsset &&
    r.sentenceIndices.some((idx) => idx >= args.shot.sentenceStartIndex && idx <= args.shot.sentenceEndIndex)
  );

  let assetDirection = "";
  if (matchingAsset) {
    assetDirection = `\nFEATURED IMAGE ASSET AVAILABLE:
- Standardized File: ${matchingAsset.standardizedFilename}
- Entity: "${matchingAsset.entityName}" (${matchingAsset.width}×${matchingAsset.height}, ${matchingAsset.aspectRatioLabel})
DIRECTIVE: Detail how this image enters and rests. Position inside an elegant rounded container (borderRadius: 24px, glassmorphic frosted border, colored glow shadow) preserving its ${matchingAsset.aspectRatioLabel} aspect ratio. Direct camera drift (scale: 1.05 -> 1.0) and staggered typography entry beside or below it.`;
  } else if (matchingMissing) {
    assetDirection = `\nMISSING IMAGE FOR ENTITY: "${matchingMissing.name}"
DIRECTIVE (CLEVER MOTION FALLBACK): The user did NOT provide an image for this entity. NEVER direct generic text. Direct a clever, high-energy motion design treatment: ${matchingMissing.cleverFallbackIdea} (e.g. regal serif initial monogram, stylized vector heraldic emblem, or classified dossier).`;
  }
  const system = `You are a senior motion-graphics art director writing a visual choreography prompt for a Remotion 2D animator.
AESTHETIC BENCHMARK: Premium broadcast-quality documentary, thriller, and tech keynote motion design matching the reference demo reel.

MASTERCLASS VISUAL ART DIRECTION REQUIREMENTS:

1. PREMIUM VISUAL FINISH (MANDATORY — THE DIFFERENCE BETWEEN "CHEAP" AND "BROADCAST"):
   - Rounded corners: ALL card, panel, slab, and container elements MUST use borderRadius: 20–28px. Never use sharp corners on any visible rectangular element.
   - Rich saturated color palette: Use vibrant, confident accent colors (electric blue #0066FF, coral #FF5A36, emerald #10B981, amber #F59E0B, violet #8B5CF6). Avoid flat gray-on-gray or washed-out pastels.
   - Colored glow shadows: Every floating card/slab gets boxShadow with colored glow: "0 20px 60px rgba(0,102,255,0.25)" for blue elements, "0 20px 60px rgba(255,90,54,0.2)" for coral, etc.
   - Glassmorphic containers: Important containers use backdrop-filter: blur(14px), background: rgba(15,23,42,0.85), border: 1px solid rgba(255,255,255,0.10). This creates the premium frosted-glass depth.
   - Depth layering (back to front): Rich gradient background → <mg.GridBackground> → Radial spotlight → Glassmorphic containers with content → <mg.Noise> overlay. All 5 layers in every shot.

2. SPATIAL STAGE & SAFE CAMERA CHOREOGRAPHY:
   - Every shot takes place on an animated spatial stage (trajectory chart, comparison board, network map, timeline, or dossier).
   ─── SAFE ZONE RULES (CRITICAL — PREVENTS CONTENT OVERFLOW) ───
   - All hero content MUST be positioned within the SAFE ZONE: x: 100–1820, y: 80–1000 at rest (zoom=1).
   - Maximum zoom: 1.3 (NEVER exceed 1.3). At zoom=1.3, content at x=1500 appears at x=1500*1.3=1950 — nearly offscreen. So at zoom=1.3, keep all content within x: 200–1700, y: 120–900.
   - Camera pan (x/y offsets) must be conservative: x range ±120px, y range ±80px.
   - MENTAL OVERFLOW TEST: Before directing any camera move, calculate: (element_x + cam_x) * zoom. If > 1820 or < 100, the content will clip. Adjust.
   - Direct continuous camera motion using <mg.CameraRig>:
     - POV Focus Zoom: start at zoom: 1.15–1.3 focusing on a hero badge, peak, or key metric. CENTERED on the focal point.
     - Follow & Tracking: smoothly pan the camera (x offset ±80px) following an entity. Keep zoom ≤ 1.2 during pans.
     - Wide Pullback: zoom out to 1.0, x: 0, y: 0 to reveal full context.
     - Ambient Drift: subtle continuous scale push (zoom: 1.0 -> 1.05) or gentle pan (x: 0 -> 30px). Default for simpler shots.
     - Geographic Map Tracking: When using <mg.MapStage>, direct camera motion along the route: start focused tightly on the origin city/country (e.g. London / UK at startZoom 2.2), follow the flight arc westward as it draws across the ocean (midZoom 1.4), and settle on the destination (New York / US at endZoom 2.0) with pulsing city beacon and country highlight.

3. ATMOSPHERIC DEPTH & VISUAL LAYERING:
   - Direct rich atmosphere: multi-stop gradient background, radial spotlight lighting, subtle grid (<mg.GridBackground>), procedural noise (<mg.Noise>), and architectural crosshair markers (<mg.Marker>).
   - Large hero visuals: giant ghost background numerals (fontSize: 800-1100), floating tilted cards (<mg.Card tilt={-2}> with borderRadius: 24px), rolling counters (<mg.Roll>), and glowing callout frames (<mg.FocusFrame>).

4. SELECTIVE & PURPOSEFUL SVG USAGE:
   - Check if this shot truly requires an illustrative entity SVG to make the spoken point understandable:
     - If YES: detail a clean, iconic vector emblem, logo, silhouette, or schematic (e.g. Amazon logo badge, dollar currency symbol, jet silhouette, battery cell, Arc Reactor) inside a glassmorphic container with rounded corners and colored glow shadow. Keep it clear, iconic, and focused (no hyper-detailed meshes).
     - If NO: focus the art direction on pristine motion graphics (floating cards with rounded corners, trend curves, rolling metrics, connected node meshes, dossiers) without inventing unnecessary decorative illustrations.

5. KINETIC TIMING & VOICE LOCK:
   - Frame 2–6: Hero component starts entering immediately with snappy spring physics (damping: 14, stiffness: 160).
   - Sync key motion events and camera shifts to local word cues. All primary reveals complete by the cue's spokenEndFrame.`;

  const prompt = `FILM CONTINUITY:
- Style: ${args.filmNorthStar}
- Palette & Rules: ${args.continuityRules.join("; ")}
- Previous Shot: ${args.previousSummary || "opening"}
- Next Shot: ${args.nextSummary || "ending"}

SHOT STORYBOARD:
- Shot ID: ${args.shot.shotId} | Frames: ${durationFrames} (${(durationFrames / 60).toFixed(1)}s)
- Spoken Line: "${args.shot.spokenText}"
- Visual Metaphor & Idea: ${args.shot.visualIdea}
- Visual Family: ${args.shot.visualFamily} | Theme: ${args.shot.themeMode}
${assetDirection}
LOCAL WORD CUES (local frames; 60fps):
${formatCompactWordCues(args.wordCues)}

Write a concise, render-ready prompt detailing composition, iconic visual metaphor, dynamic camera moves, and voice-synced reveals.`;

  return structured<ShotVisualPrompt>(VISUAL_PROMPT_SCHEMA, system, prompt, {
    temperature: 0.45,
    maxTokens: 3000,
  });
}

/** Stage 4 worker: generate a distinct, complete Remotion composition for one shot. */
export async function generateRemotionShotCode(args: {
  shot: CreativeShotPlan & { durationFrames?: number };
  visualPrompt: ShotVisualPrompt;
  wordCues: WordCue[];
  filmContinuity: { palette: string; typography: string; texture: string; rules: string[] };
  previousSummary: string;
  nextSummary: string;
  availableAssets?: UploadedImageAsset[];
  validationError?: string;
  retryNumber?: number;
}): Promise<GeneratedCodeOutput> {
  const durationFrames = args.shot.durationFrames ?? (args.wordCues.length ? Math.max(120, args.wordCues.at(-1)!.spokenEndFrame + 30) : 180);
  const system = `You are an elite motion-graphics engineer authoring bespoke Remotion TSX components for a documentary, thriller, and explainer video engine (1920x1080 @ 60fps).
Your benchmark: Premium broadcast tech motion design matching the reference demo reel, Apple/OpenAI keynotes, Vox, and ColdFusion.

═══════════════════════════════════════════════════════════════════════════════
SECTION 1: COMPILER CONTRACT & STRICT RULES (ZERO TOLERANCE — AST ENFORCED)
═══════════════════════════════════════════════════════════════════════════════
1. FILE LENGTH & CONCISENESS BUDGET (AVOIDS TOKEN CUTOFF):
   - TARGET: 90 TO 150 LINES OF TSX (HARD CEILING: 165 LINES).
   - Bloated 200+ line components run out of completion tokens, cut off mid-file, and fail with SyntaxError.
   - Declarative code using @frame60/mg primitives is superior, faster to render, and 100% bug-free.
   - NEVER hand-write 40-coordinate SVG paths or 20-line <defs><filter> blocks. Use CSS drop-shadow/boxShadow.

2. ABSOLUTE FORBIDDEN PATTERNS (WILL IMMEDIATELY FAIL AST VALIDATION):
   - NO "while" or "do...while" loops: AST validator immediately rejects WhileStatement. Always use bounded "for (let i = 0; i < N; i++)" or "Array.from({length: N}).map(...)".
   - NO "window", "document", "navigator", "globalThis": Headless Remotion environments have no DOM globals. Always read dimensions from: const { width, height, fps, durationInFrames } = useVideoConfig();
   - NO CSS "mask", "maskImage", or SVG "<mask id=...>": Remotion's web renderer throws fatal errors on CSS masks! To clip elements, use SVG <clipPath id="...">, CSS overflow: "hidden", or opacity interpolation.
   - NO CSS keyframe animations or transitions: Motion must be derived purely from frame, interpolate(), and spring().
   - NO Math.random(): Remotion requires deterministic frame rendering. Use random(seed) from "remotion".
   - NO text-only slides: Never make a scene that is primarily centered text or word cue dumps. Audio conveys the spoken words; the canvas must show an ACTIVE VISUAL EXPLANATION (vector map, trajectory chart, split cards, network mesh, or bento metric matrix).

═══════════════════════════════════════════════════════════════════════════════
SECTION 2: BULLETPROOF REMOTION COMPONENT ANATOMY (EXACT BLUEPRINT)
═══════════════════════════════════════════════════════════════════════════════
Follow this clean 4-phase file structure:
\`\`\`tsx
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring, Easing } from "remotion";
import { mg } from "@frame60/mg";

const C = { ink: "#F8FAFC", blue: "#0066FF", coral: "#FF5A36", emerald: "#10B981", amber: "#F59E0B", slate: "#1E293B" };
const ease = Easing.inOut(Easing.cubic);

export const GeneratedShot = (props: { wordCues?: Array<{ wordIndex?: number; startFrame?: number; word?: string }> }) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const cues = props.wordCues || [];
  const cueAt = (idx: number, fallback: number) => {
    const f = cues.find(c => c.wordIndex === idx);
    return typeof f?.startFrame === "number" ? f.startFrame : fallback;
  };

  // Snappy spring & interpolations
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 160, mass: 0.8 } });
  const panX = interpolate(frame, [0, durationInFrames], [0, 40], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: "linear-gradient(160deg, #070A12 0%, #0F172A 50%, #05070D 100%)", overflow: "hidden" }}>
      {/* Layer 2: Subtle structural grid */}
      <mg.GridBackground mode="dark" gridSize={48} />
      {/* Layer 3: Warm directional spotlight */}
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(60% 70% at 70% 30%, rgba(0,102,255,0.14), transparent 70%)" }} />

      {/* Layer 4: Stage Content inside CameraRig (safe zoom <= 1.3, safe pans <= 120px) */}
      <mg.CameraRig zoom={1.05 + 0.1 * enter} x={panX} y={0}>
        {/* Main visual payload: MapStage, Split Cards, Chart, or Network Nodes */}
      </mg.CameraRig>

      {/* Compact Top-Left Editorial Heading */}
      <mg.Heading kicker="PACIFIC METRICS" title="Headline Text" frameAt={0} style={{ position: "absolute", left: 100, top: 70 }} />

      {/* Layer 5: Film Grain Texture */}
      <mg.Noise opacity={0.035} />
    </AbsoluteFill>
  );
};
\`\`\`

═══════════════════════════════════════════════════════════════════════════════
SECTION 3: PREMIUM VISUAL FINISH (MATCHING THE DEMO REEL)
═══════════════════════════════════════════════════════════════════════════════
A. ROUNDED CORNERS ON EVERYTHING:
   - Every card, panel, container, metric box, and badge MUST use borderRadius: 20–28px.
   - Pill-shaped badges use borderRadius: 9999px.
   - SVG rect elements use rx={20} ry={20}. Never leave sharp 0px corners.

B. RICH SATURATED PALETTE & COLORED GLOW SHADOWS:
   - Primary: #0066FF (electric blue) or #3B82F6 (sky blue).
   - Accents: #FF5A36 (coral), #10B981 (emerald), #F59E0B (amber), #8B5CF6 (violet).
   - Floating cards use colored glow shadows: boxShadow: "0 20px 60px rgba(0,102,255,0.25), 0 8px 24px rgba(0,0,0,0.4)".
   - Glassmorphism: background: "rgba(15,23,42,0.82)", backdropFilter: "blur(14px)", border: "1px solid rgba(255,255,255,0.10)".

C. CAMERA SAFE ZONE (AVOIDS OVERFLOW):
   - ALL hero elements positioned within x: 120–1800, y: 100–980.
   - MAXIMUM zoom: 1.3. NEVER zoom above 1.3. Camera pan offsets: ±100px max.

═══════════════════════════════════════════════════════════════════════════════
SECTION 4: PRE-BUILT PRIMITIVES TOOLKIT (@frame60/mg) — USE THESE TO SAVE CODE
═══════════════════════════════════════════════════════════════════════════════
1. GEOGRAPHIC WORLD MAP (<mg.MapStage>):
   When narration discusses countries, continents, or global movements, USE <mg.MapStage>.
   - Authentic Natural Earth 110m world vector map with automatic country recognition ("Canada", "US", "South America", "Europe", "Indonesia", "Australia", "China", "Japan", etc.).
   - Narrative Camera Sequence: Drive camera across spoken locations, dim inactive countries (dimInactive={true}), and anchor callout pins directly:
   \`\`\`tsx
   <mg.MapStage
     theme="dark"
     dimInactive={true}
     camera={{
       sequence: [
         { atFrame: 0, focus: "world", zoom: 1.0 },
         { atFrame: cueAt(10, 20), focus: "Canada", zoom: 2.3 },
         { atFrame: cueAt(45, 80), focus: "US", zoom: 2.4 },
         { atFrame: cueAt(85, 150), focus: "South America", zoom: 2.0 },
         { atFrame: cueAt(130, 220), focus: ["Indonesia", "Australia"], zoom: 1.8 },
         { atFrame: cueAt(180, 290), focus: "world", zoom: 1.0 },
       ]
     }}
   >
     <mg.MapHighlight country="Canada" color="#FF5A36" active={frame >= cueAt(10, 20)} />
     <mg.MapHighlight country="US" color="#0066FF" active={frame >= cueAt(45, 80)} />
     <mg.MapHighlight country="South America" color="#10B981" active={frame >= cueAt(85, 150)} />
     <mg.MapHighlight country={["Indonesia", "Australia"]} color="#F59E0B" active={frame >= cueAt(130, 220)} />

     <mg.MapPin location="Canada" label="CANADA" sublabel="Warmer winters" frameAt={cueAt(10, 20)} color="#FF5A36" />
     <mg.MapPin location="US" label="SOUTHERN US" sublabel="Heavier rain" frameAt={cueAt(45, 80)} color="#0066FF" />
     <mg.MapPin location="South America" label="SOUTH AMERICA" sublabel="Flooding risk" frameAt={cueAt(85, 150)} color="#10B981" />
     <mg.MapPin location="Australia" label="AUSTRALIA" sublabel="Severe drought" frameAt={cueAt(130, 220)} color="#F59E0B" />
   </mg.MapStage>
   \`\`\`
   - Routes: <mg.MapRoute from="London" to="New York" progress={p} color="#0066FF" showBeacon />.

2. FLOATING GLASS CARDS (<mg.Card>):
   - <mg.Card width={620} height={380} tilt={-2} mode="dark"> ... </mg.Card>
   - Automatically provides rounded corners, dark glass backdrop, crisp borders, and colored drop shadow.

3. KINETIC COUNTER (<mg.Roll>):
   - <mg.Roll value={42} suffix="%" fontSize={80} color="#0066FF" frameAt={cueAt(15, 30)} />

4. EDITORIAL HEADING (<mg.Heading>):
   - <mg.Heading kicker="PACIFIC DYNAMICS" title="Headline" frameAt={0} style={{ position: "absolute", left: 100, top: 70 }} />

5. KINETIC TYPOGRAPHY (<mg.ImpactLine>):
   - <mg.ImpactLine text="CRITICAL THRESHOLD REACHED" frameAt={cueAt(10, 20)} size="hero" color="#F8FAFC" />

6. CAMERA STAGE (<mg.CameraRig>):
   - <mg.CameraRig zoom={zoom} x={panX} y={panY}> ... </mg.CameraRig> (zoom strictly <= 1.3).`;

  const compactCues = formatCompactWordCues(args.wordCues);

  // Intelligent error diagnosis to guarantee instant fix on retry
  let retryDiagnosis = "";
  if (args.validationError) {
    if (/Unexpected token|SyntaxError/i.test(args.validationError)) {
      retryDiagnosis = `\n[CRITICAL COMPILER FIX REQUIRED - CODE TRUNCATION / SYNTAX ERROR]:
Your previous attempt failed with: ${args.validationError}
CAUSE: Your TSX code was cut off at the end of the file because it was too long (>220 lines).
SOLUTION: Keep your TSX component strictly between 90 and 140 lines! Use <mg.*> primitives (e.g. mg.MapStage, mg.Card, mg.Roll, mg.Heading) to replace hundreds of lines of manual SVG paths, coordinate arrays, or nested divs. Ensure all JSX tags, parentheses, and braces are cleanly closed before the end of the file.`;
    } else if (/WhileStatement|DoWhileStatement/i.test(args.validationError)) {
      retryDiagnosis = `\n[CRITICAL COMPILER FIX REQUIRED - FORBIDDEN WHILE LOOP]:
Your previous attempt failed with: ${args.validationError}
CAUSE: You used a while loop, which AST validation strictly bans in Remotion to avoid infinite hangs.
SOLUTION: Replace the while loop with a bounded "for (let i = 0; i < N; i++)" loop or "Array.from({ length: N }).map(...)".`;
    } else if (/window|document|navigator|globalThis/i.test(args.validationError)) {
      retryDiagnosis = `\n[CRITICAL COMPILER FIX REQUIRED - FORBIDDEN BROWSER GLOBAL]:
Your previous attempt failed with: ${args.validationError}
CAUSE: You referenced a browser/DOM global ("window" or "document"). Remotion components run in headless Node/worker environments.
SOLUTION: Remove all references to window and document. Read screen width, height, fps from const { width, height, fps, durationInFrames } = useVideoConfig();`;
    } else if (/mask/i.test(args.validationError)) {
      retryDiagnosis = `\n[CRITICAL COMPILER FIX REQUIRED - FORBIDDEN CSS MASK]:
Your previous attempt failed with: ${args.validationError}
CAUSE: You used CSS mask/maskImage or SVG <mask id=...>. Remotion's web renderer throws fatal errors on CSS masks.
SOLUTION: Remove mask/maskImage entirely. Use SVG <clipPath id="..."> with <rect rx={20}>, CSS overflow: "hidden", or opacity interpolation instead.`;
    } else if (/not an approved primitive/i.test(args.validationError)) {
      retryDiagnosis = `\n[CRITICAL COMPILER FIX REQUIRED - UNAPPROVED PRIMITIVE]:
Your previous attempt failed with: ${args.validationError}
CAUSE: You used a JSX tag that is not in the safe HTML whitelist.
SOLUTION: Use standard approved HTML tags (div, span, p, h1-h6, strong, em, br, hr, canvas, ul, li) or <mg.*> primitives.`;
    } else {
      retryDiagnosis = `\n[CRITICAL COMPILER FIX REQUIRED]:
Your previous attempt failed with: ${args.validationError}
SOLUTION: Fix this exact issue in your TSX output now.`;
    }
  }

  let assetInstructions = "";
  if (args.availableAssets && args.availableAssets.length > 0) {
    const list = args.availableAssets
      .map((a) => `• props.assets['${a.standardizedFilename}'] (Entity: "${a.entityName}", Dimensions: ${a.width}×${a.height}, ${a.aspectRatioLabel})`)
      .join("\n");
    assetInstructions = `\nAVAILABLE IMAGE ASSETS IN PROPS:
${list}

IMAGE RENDERING RULES (WHEN PRESENT IN SHOT):
- Remotion <Img /> is fully approved. Import it from "remotion": import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring, Img } from "remotion";
- Access asset from props.assets:
  const asset = props.assets?.["${args.availableAssets[0].standardizedFilename}"] || (props.assets ? Object.values(props.assets)[0] : null);
- Wrap the image in a styled glassmorphic container preserving its aspect ratio:
  \`\`\`tsx
  {asset && (
    <div style={{
      position: "absolute",
      left: 140,
      top: 180,
      width: 520,
      height: 680,
      borderRadius: 24,
      overflow: "hidden",
      border: "1px solid rgba(255,255,255,0.15)",
      boxShadow: "0 24px 80px rgba(0,102,255,0.25)",
      opacity: enter,
    }}>
      <Img src={asset.url} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </div>
  )}
  \`\`\`
- IF NO IMAGE WAS PROVIDED FOR AN ENTITY: Do not crash or render empty space! Render the clever vector / monogram / heraldic seal choreography defined in the visual prompt!
`;
  }

  const prompt = `${args.validationError ? `RETRY ${args.retryNumber ?? 1}.${retryDiagnosis}\n\n` : ""}SHOT DIRECTION:
- Shot ID: ${args.shot.shotId} | Duration: ${durationFrames} frames (${(durationFrames / 60).toFixed(1)}s)
- Spoken Narration: "${args.shot.spokenText}"
- Visual Theme: ${args.shot.themeMode || "dark"} | Family: ${args.shot.visualFamily || "editorial"}
- Visual Metaphor: ${args.visualPrompt.visualMetaphor || args.shot.visualIdea}
- Composition: ${args.visualPrompt.composition || "Hero entity centered with dynamic camera tracking"}
- Camera Choreography: ${args.visualPrompt.cameraChoreography || "Smooth POV zoom/pan tracking key entity"}
- Key Elements: ${(args.visualPrompt.elements || []).join(", ")}
${assetInstructions}
- Word Cues (local frame sync):
${compactCues}

Palette: ${args.filmContinuity.palette || "slate, cyan, white"}
Typography: ${args.filmContinuity.typography || "Inter, system-ui"}

Return a fully authored Remotion TSX module in sourceCode. Target 90–150 lines of crisp, clean, broadcast-ready code. Deliver high-impact visual depth, rounded corners, colored glow shadows, and snappy motion graphics matching the demo reel.`;

  return structured<GeneratedCodeOutput>(GENERATED_CODE_SCHEMA, system, prompt, {
    temperature: 0.2,
    maxTokens: 16384,
  });
}
