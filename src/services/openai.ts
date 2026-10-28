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
}): Promise<CreativePlanOutput> {
  const system = `You are the CREATIVE DIRECTOR and MOTION GRAPHICS SUPERVISOR for a bespoke Remotion 2D animated film (1920x1080 @ 60fps).
BENCHMARK: Premium documentary, thriller, and explainer channels (Vox, Johnny Harris, Magnates Media, ColdFusion, Bloomberg Quicktake).

PRIMARY VISUAL AESTHETIC — CINEMATIC EXPLAINER & DOCUMENTARY MOTION DESIGN:
- Every single scene MUST feature a LARGE, PROMINENT ANIMATED VISUAL STAGE or HERO COMPONENT occupying 65% to 85% of the 1920x1080 canvas.
- Text is supporting copy ONLY (a compact 1-line headline + kicker at top-left).
- Dynamic camera choreography: POV zoom-in, tracking pan along trajectory/graph, and zoom-out context reveals.

DYNAMIC SCENE COUNT & PACING (DOCUMENTARY & EXPLAINER STANDARD):
- Shot count MUST scale with the audio duration:
  - ~30 seconds of audio -> 2 to 3 scenes
  - ~60 seconds (1 min) -> 4 to 6 scenes
  - ~120 seconds (2 mins) -> 8 to 11 scenes
  - ~240 seconds (4 mins) -> 14 to 18 scenes
  - ~480 seconds (8 mins) -> 28 to 36 scenes
- Target 12 to 18 seconds per scene: gives camera choreography, tracking, and contextual reveals time to breathe (never drag beyond 22s unless a single long sentence).

MANDATORY HERO COMPONENT ARCHETYPES (Plan one for every shot's 'visualIdea'):
1. [Trajectory & Camera Follow]: 1400px SVG graph path / area chart with dynamic camera POV zoom into peak, camera follows the entity badge along its descent/trajectory, zoom-out reveals full graph context, secondary symbols (money/currency $ signs, injection flow, rescue markers) flow into entity.
2. [Dual Comparison Board]: 2 large floating glassmorphic comparison cards (width: 700px each) comparing models, eras, or options with brand badges, metric rows, and an animated coral focus frame (<mg.FocusFrame>).
3. [Ranked Bar / Milestone Timeline]: Baseline line with 3-4 thick vertical bars or milestone date pillars shooting up with spring physics, rolling numbers atop each bar (<mg.Roll>), and winner singled out.
4. [System & Capital Flow Mesh]: 6-8 system/pipeline node pills linked by curved bezier lines with glowing traveling pulse packets and sonar pulse rings.
5. [Bento Metric Dossier]: 3-4 structured large metric slabs filling the frame with rolling counters (<mg.Roll>), percentage rings, and status tags.
6. [Query & Inspection Trace]: Search/terminal input typing out query character-by-character with 3-4 cascading result cards, or dossier table with floating magnifier reticle.
7. [Bespoke Iconic Entity Graphic]: When a company, vehicle, currency, hardware, or subject is discussed (Amazon, plane, helicopter, Iron Man arc reactor / armor tech, battery, chip, dollar/money, server):
   CRITICAL RULE: DO NOT plan complex anatomical humanoid drawings (no multi-joint finger/knee bezier meshes). Instead, plan an ICONIC, HIGH-IMPACT VECTOR BADGE, EMBLEM, SILHOUETTE, or SCHEMATIC with motion telemetry, glowing HUD rings, and dynamic camera choreography.

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
- Every shot's 'visualIdea' MUST state the component archetype and what large animated visual component is shown.`;

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

  const prompt = `${args.repairErrors?.length ? `REPAIR THE PREVIOUS PLAN. Fix these exact issues:\n${args.repairErrors.join("\n")}\n\n` : ""}${durationText}
USER CREATIVE BRIEF (honor unless it conflicts with transcript truth): ${args.creativeBrief || "No extra direction; invent the most apt visual treatment from the narration."}
Reference finish guidance (inspiration only, do not reproduce): ${args.referenceStyle}
${windowBrief}
SENTENCE DIGEST (the only legal shot-boundary source; use words:start..end ranges for emphasisWordIndices):
${args.transcriptDigest.join("\n")}

Return a complete storyboard for sentences ${first}..${last}. Use each of those sentences exactly once, contiguous and in order, starting at sentenceStartIndex ${first} and ending at sentenceEndIndex ${last}. Let the content decide how many shots that needs.`;

  // Output budget scales with the range so long films are never truncated mid-plan.
  const sentenceCount = last - first + 1;
  const estimatedShots = Math.max(2, Math.ceil(sentenceCount / 2.2));
  const maxTokens = Math.min(16000, 4000 + estimatedShots * 250);

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
}): Promise<ShotVisualPrompt> {
  const durationFrames = args.shot.durationFrames ?? (args.wordCues.length ? Math.max(120, args.wordCues.at(-1)!.spokenEndFrame + 30) : 180);
  const system = `You are a senior motion-graphics art director writing a visual choreography prompt for a Remotion 2D animator.
AESTHETIC: High-impact documentary, thriller, and explainer motion design (Vox, Johnny Harris, Magnates Media, ColdFusion).

DOCUMENTARY & EXPLAINER VISUAL LANGUAGE:
1. SPATIAL STAGE & CAMERA CHOREOGRAPHY:
   - Every shot takes place on an animated spatial stage (e.g. trajectory chart, comparison board, network map, timeline, or schematic blueprint).
   - Choreograph dynamic camera movement:
     - POV Macro Zoom: start zoomed into the hero badge, peak, or key data point.
     - Camera Follow / Tracking: camera smoothly tracks the subject moving along its path (e.g. an entity falling down a graph line).
     - Wide Pullback: camera zooms out to reveal the full graph, historical trajectory, and surrounding data context.
     - Secondary Action: animate secondary elements (such as glowing currency/money $ symbols, rescue markers, or injection flows) traveling into the hero entity.

2. SELECTIVE & PURPOSEFUL SVG ART DIRECTION:
   - Check if this shot truly requires an illustrative entity SVG to make the spoken point understandable:
     - If YES: detail a clean, iconic vector emblem, logo, silhouette, or schematic (e.g. Amazon logo badge, dollar currency symbol, jet silhouette, battery cell, Arc Reactor) and how it sits within the spatial stage. Keep it clear, iconic, and focused (no hyper-detailed meshes) — just enough for the viewer to immediately understand the meaning.
     - If NO: focus the art direction on pristine motion graphics (floating cards, trend curves, rolling metrics, connected node meshes, dossiers) without inventing unnecessary decorative illustrations.

3. KINETIC TIMING:
   - Frame 2–6: Hero component starts entering immediately with snappy spring physics.
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

LOCAL WORD CUES (local frames; 60fps):
${formatCompactWordCues(args.wordCues)}

Write a concise, render-ready prompt detailing composition, iconic visual metaphor, dynamic camera moves, and voice-synced reveals.`;

  return structured<ShotVisualPrompt>(VISUAL_PROMPT_SCHEMA, system, prompt, {
    temperature: 0.45,
    maxTokens: 2000,
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
  validationError?: string;
  retryNumber?: number;
}): Promise<GeneratedCodeOutput> {
  const durationFrames = args.shot.durationFrames ?? (args.wordCues.length ? Math.max(120, args.wordCues.at(-1)!.spokenEndFrame + 30) : 180);
  const system = `You are an elite motion-graphics engineer authoring bespoke Remotion TSX components for a documentary, thriller, and explainer video engine (1920x1080 @ 60fps).
Your benchmark: Vox, Johnny Harris, Magnates Media, ColdFusion, and Bloomberg Quicktake.

VISUAL STANDARD — DOCUMENTARY & EXPLAINER MOTION GRAPHICS:
1. SPATIAL STAGE & DYNAMIC CAMERA CHOREOGRAPHY:
   - Every shot takes place on an animated spatial canvas (trend chart, comparison board, network map, timeline, or blueprint).
   - CAMERA MOVES (POV & TRACKING): Drive camera motion using interpolate() on frame with <mg.CameraRig zoom={...} x={...} y={...}> or a transformed container.
     Example (User's Amazon / Stock Fall & Rescue Choreography):
     - Start zoomed in close (zoom: 1.5–1.8, focused POV on the entity badge or graph peak).
     - As narrative shifts (e.g. losing peak, falling, crisis), the camera tracks the entity moving downward along the trajectory line.
     - Zoom out (zoom: 1.0, x: 0, y: 0) to reveal the macro trend, surrounding data markers, and historical context.
     - When a subsequent event occurs (e.g. borrowing money, rescue), animate secondary elements (e.g. floating $ currency icons, injection arrows, glowing relief nodes) flowing into the entity!

2. SELECTIVE & PURPOSEFUL SVGs (NOT EVERYWHERE, JUST ENOUGH TO GROUND MEANING):
   - Only draw an illustrative SVG if the visual prompt specifically calls for an entity/symbol (e.g. Amazon logo badge, dollar/money icon, battery cell, jet silhouette) to explain that specific point.
   - If the shot is about comparisons, trends, systems, or metrics, DO NOT force an arbitrary drawing. Instead, build a pristine motion graphic using <mg.Card>, <mg.Stroke>, <mg.Roll>, <mg.FocusFrame>, <mg.GridBackground>, and clean HTML/React UI elements.
   - When an illustrative SVG IS called for:
     - Keep it clean, iconic, and uncluttered (5 to 15 well-structured SVG elements: clean <path>, <circle>, <rect>, <polygon>, <linearGradient>).
     - Give the viewer just enough visual fidelity to understand the complete meaning instantly — never overloaded, never distracting.
     - Strictly NO complex humanoid body drawings with fingers/knees (prevents distorted anatomy).

3. PROVEN EXPLAINER SCENE ARCHETYPES:
   A. Trajectory & Camera Follow (The Amazon / Trend Archetype):
      - 1400px SVG graph path with gradient underfill.
      - Entity badge (company logo, vehicle, or token) anchored to current (x, y) along the curve.
      - Camera tracks from peak POV -> follows plunge -> zooms out to reveal full trajectory -> money/solution symbols flow in.
   B. Dual Comparison Board:
      - 2 floating glass cards (e.g., Old vs New, Peak vs Collapse, Competitor A vs B) with metric badges, differential delta (+45% / -60%), and <mg.FocusFrame>.
   C. Ranked Bar / Milestone Timeline:
      - Baseline line with milestone pillars or date bars (e.g., 2003, 2008, 2020) springing up with rolling counters (<mg.Roll>) and highlight pin.
   D. Connected System / Network Flow:
      - Nodes linked by glowing curved bezier paths with traveling pulse packets (<mg.Stroke> or dashed offset) showing capital flow, data transfer, or supply chain.
   E. Bento Metric Dossier:
      - Documentary dossier / investigative grid with rolling numbers, status pills, and high-contrast callout boxes.
   F. Blueprint / Telemetry Schematic:
      - Technical schematic layout with crosshair markers (<mg.Marker>), circular HUD rings, and annotated dimension callouts.

4. ANIMATION TIMING & VOICE LOCK:
   - Fast initial reveal: Entrance starts at frame 2–6 with snappy spring physics (stiffness: 160, damping: 14).
   - Word sync: Key reveals and camera shifts trigger precisely when narration speaks the word (frame >= cue.startFrame).
   - Smooth interpolation: interpolate(frame, [start, end], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }).

5. REMOTION CODE CONTRACT:
   - Imports:
     import React from "react";
     import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, interpolate, spring, Easing, random } from "remotion";
     import { mg } from "@frame60/mg";
   - Export:
     export const GeneratedShot = (props) => { ... };
   - Inside:
     const frame = useCurrentFrame();
     const { fps, width, height, durationInFrames } = useVideoConfig();
     const cues = props.wordCues || [];
   - Compact top-left documentary heading:
     <mg.Heading kicker="DOCUMENTARY DOSSIER" title="Headline" frameAt={2} style={{ position: "absolute", left: 100, top: 70, maxWidth: 1100 }} />
   - Center / Stage:
     Use <mg.CameraRig zoom={zoom} x={panX} y={panY}> for camera moves, or a root container with transform.
   - Clean TSX only. No external URLs, no browser window/document globals, no Markdown backticks inside the sourceCode string.`;

  const compactCues = formatCompactWordCues(args.wordCues);

  const prompt = `${args.validationError ? `RETRY ${args.retryNumber ?? 1}. Fix this exact error:\n${args.validationError}\n\n` : ""}SHOT DIRECTION:
- Shot ID: ${args.shot.shotId} | Duration: ${durationFrames} frames (${(durationFrames / 60).toFixed(1)}s)
- Spoken Narration: "${args.shot.spokenText}"
- Visual Theme: ${args.shot.themeMode || "dark"} | Family: ${args.shot.visualFamily || "editorial"}
- Visual Metaphor: ${args.visualPrompt.visualMetaphor || args.shot.visualIdea}
- Composition: ${args.visualPrompt.composition || "Hero entity centered with dynamic camera tracking"}
- Camera Choreography: ${args.visualPrompt.cameraChoreography || "Smooth POV zoom/pan tracking key entity"}
- Key Elements: ${(args.visualPrompt.elements || []).join(", ")}
- Word Cues (local frame sync):
${compactCues}

Palette: ${args.filmContinuity.palette || "slate, cyan, white"}
Typography: ${args.filmContinuity.typography || "Inter, system-ui"}

Return a fully authored Remotion TSX module in sourceCode. Focus on crisp documentary motion design, dynamic camera tracking, and iconic vector symbols without anatomical drawing complexity.`;

  return structured<GeneratedCodeOutput>(GENERATED_CODE_SCHEMA, system, prompt, {
    temperature: 0.2,
    maxTokens: 3200,
  });
}
