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

PRIMARY VISUAL AESTHETIC — FAST, BROADCAST-GRADE 2D TECH MOTION DESIGN:
Benchmark your direction against Apple/OpenAI keynote motion graphics and the demo reel:
- Every single scene MUST feature a LARGE, PROMINENT ANIMATED VISUAL COMPONENT occupying 65% to 85% of the 1920x1080 canvas.
- Text is supporting copy ONLY (a compact 1-line headline + kicker at top-left). Scenes that are just text, headlines, paragraphs, or word highlights are STRICTLY FORBIDDEN.
- Animation is FAST and punchy: components slam, expand, or spring into frame starting at frame 2–6 (within 0.1s), with snappy spring physics (stiffness: 160, damping: 14) and fast item staggers (4–6 frames).

DYNAMIC SCENE COUNT & PACING:
- Shot count MUST scale with the audio duration:
  - ~30 seconds of audio -> 3 to 5 scenes
  - ~60 seconds (1 min) -> 6 to 9 scenes
  - ~120 seconds (2 mins) -> 12 to 16 scenes
  - ~240 seconds (4 mins) -> 22 to 28 scenes
  - ~480 seconds (8 mins) -> 45 to 55 scenes
- Target 6 to 12 seconds per scene for fast, punchy pacing (never drag a single scene beyond 15s unless it's a single long sentence).
- Never fix or clamp the shot count to a static preset; let the speech duration and sentence flow decide the number of scenes.

MANDATORY HERO COMPONENT ARCHETYPES (You must plan one for every shot's 'visualIdea'):
1. [Comparison Cards]: 2 large floating panels (light vs dark, width: 700px, height: 420px each) comparing models, pricing, or options with brand badges, metric rows, and an animated coral/orange callout focus frame (<mg.FocusFrame>).
2. [Ranked Bar Comparison]: Drawn baseline line with 3-4 thick vertical bars shooting up with spring physics, rolling numbers atop each bar, and winner singled out with accent glow.
3. [SVG Line Chart Story]: 1400px wide area/line trend chart with grid lines, gradient underfill, trim-path stroke reveal (<mg.Stroke>), and peak callout pin with rolling numeral.
4. [Connected Node Mesh]: 6-8 system/pipeline node pills linked by curved bezier lines with glowing traveling pulse packets and sonar pulse rings.
5. [Bento Metric Grid]: 3-4 structured large metric slabs filling the frame with rolling counters (<mg.Roll>), percentage rings, and status tags.
6. [Query & Inspection Trace]: Search/terminal input typing out query character-by-character with 3-4 cascading result cards with confidence scores, or data table with floating magnifier reticle.
7. [Stat Slab & Capsule]: Expanding capsule pill with rolling odometer (<mg.Roll>) and giant 800px ghost background numeral.

ANTI-ILLUSTRATION RULE:
DO NOT attempt literal figurative illustrations or complex physical sketches (no human bodies/anatomy, no robotic arms, no propulsion backpacks). Motion graphics communicate through clean 2D visual structures: cards, metric slabs, callout highlight boxes, typography, charts, and node graphs.

WORD ALIGNMENT IS SACRED:
The provided word list has global integer frame starts, spoken ends, pause frames, and ASR confidence. Use those global word indices for emphasis. Never invent or rewrite the spoken transcript. Never output float timestamps. Shot boundaries are sentence indices only; the runtime derives all frame times.

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
  const estimatedShots = Math.max(2, Math.ceil(sentenceCount / 1.4));
  const maxTokens = Math.min(100000, 40000 + estimatedShots * 400);

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

AESTHETIC: Fast, broadcast-quality 2D motion graphics (1920x1080 @ 60fps).

MANDATORY HERO COMPONENT (NO TEXT-ONLY SCENES):
- The scene MUST be dominated by a LARGE ANIMATED VISUAL COMPONENT filling 65% to 85% of the 1920x1080 comp.
- Text is kept compact at top-left (e.g. <mg.Heading kicker='...' title='...' frameAt={2} style={{ position: 'absolute', left: 100, top: 70 }} />).
- Specify the exact large component architecture, dimensions, and layout:
  - e.g., "Two 720x420px floating comparison cards tilted -2° and +2° with metric tiles and an animated coral focus frame"
  - e.g., "1400x520px ranked bar chart with 3 bars shooting up from a baseline with glowing winner spotlight"
  - e.g., "1400x500px SVG line chart with gradient underfill, pen path, and peak callout"
  - e.g., "1500x550px 8-node connected network mesh with curved bezier lines and traveling pulse packets"
  - e.g., "1400x620px 3-block bento metric grid with rolling numbers and status tags"
  - e.g., "Terminal search bar typing out query with 3 cascading result cards"

FAST ANIMATION TIMING (From Demo Reel):
- Frame 2–6: Hero component starts entering immediately with snappy spring physics (stiffness: 160, damping: 14).
- Frame 8–18: Internal tiles, bars, or nodes reveal with quick 4-frame staggers.
- Frame 16–26: Focus callout frame (<mg.FocusFrame>) or winner highlight pops around the key metric.
- Continuous: Subtle camera push (<mg.CameraRig zoom={1.03}>) and traveling pulses.

CRITICAL CONSTRAINT:
DO NOT describe human anatomy, body silhouettes, mechanical robots, robotic arms, or physical sketches. Focus entirely on large 2D graphic components: cards, stat slabs, callout frames, charts, typography, and node graphs.

Tie animation events to the provided local word indexes. All important motion reveals must complete by the cue's spokenEndFrame.`;
  const prompt = `FILM NORTH STAR: ${args.filmNorthStar}
CONTINUITY RULES: ${args.continuityRules.join("; ")}
PREVIOUS SHOT VISUAL (avoid copying): ${args.previousSummary || "opening shot"}
NEXT SHOT VISUAL (set up without repeating): ${args.nextSummary || "film ending"}

SHOT STORYBOARD:
${JSON.stringify(args.shot, null, 2)}

EXACT LOCAL WORD CUES (local frames; 60fps):
${wordTable(args.wordCues)}

Write a render-ready prompt detailed enough that another model can independently code the scene without guessing.`;
  return structured<ShotVisualPrompt>(VISUAL_PROMPT_SCHEMA, system, prompt, {
    temperature: 0.45,
    maxTokens: 8192,
  });
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

VISUAL STANDARD — FAST, BROADCAST-GRADE 2D TECH MOTION GRAPHICS:
Your output must look like a scene from an Apple/OpenAI keynote or the demo reel:

1. MANDATORY HERO COMPONENT (STRICT ANTI-TEXT-ONLY RULE):
   - A scene that is just <h1>, <p>, or <mg.WordCue> text with a background is a COMPLETE FAILURE.
   - 65% to 85% of the 1920x1080 screen MUST be occupied by a LARGE, ANIMATED VISUAL COMPONENT.
   - Text is strictly for a compact top-left heading: <mg.Heading kicker="..." title="..." frameAt={2} style={{ position: "absolute", left: 100, top: 70, maxWidth: 1100 }} />.
   - The entire center and bottom of the comp (y: 200 to 1000) belongs to the hero component!

2. FAST ANIMATION TIMING (From the Reference Demo Reel):
   - Components enter FAST: animation starts at frame 2 to 6 (no waiting).
   - Snappy spring physics: spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 160, mass: 0.8 } }).
   - Fast item staggers: 4 to 6 frames between cards/bars/nodes.
   - Focus callouts: <mg.FocusFrame frameAt={18} color="#FF5500" borderRadius={16}> popping around key metrics with spring physics.
   - Smooth continuous camera push: <mg.CameraRig zoom={interpolate(frame, [0, durationInFrames], [1, 1.04], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}>.

3. CHOOSE AND BUILD ONE OF THESE 6 PROVEN DEMO COMPONENT ARCHETYPES:

   ARCHETYPE A: DUAL COMPARISON CARDS (Image 2 & SplitComparison)
   - Layout: Two large floating cards (<mg.Card width={700} height={420} tilt={-2} mode="light"> and <mg.Card width={700} height={420} tilt={2} mode="dark">) positioned side-by-side or overlapping at center (top: 260px).
   - Content: Brand/product icon badge + title, micro-tags, row of 2-3 metric tiles (Context, Input, Output), and <mg.FocusFrame> around the winning metric!
   - Animation: Card 1 springs in at frame 4, Card 2 springs in at frame 9, focus box pops at frame 18.

   ARCHETYPE B: RANKED BAR COMPARISON (BarComparison from Demo)
   - Layout: Baseline line drawn at y: 860 (<line x1={160} x2={1760} y1={860} y2={860} stroke="rgba(255,255,255,0.2)" strokeWidth={3} />).
   - 3 to 4 massive bars (width: 240px, heights: 300-520px) shooting up from baseline:
     const barH = spring({ frame: frame - (10 + i * 6), fps, config: { damping: 14, stiffness: 150 } }) * targetH;
   - Bold number on top of each bar, label below baseline. Winner bar highlighted with accent color, glow, and side callout odometer.

   ARCHETYPE C: SVG LINE CHART STORY (ChartStory from Demo)
   - Layout: 1400x500px SVG chart centered at top: 280px. 4 horizontal grid lines with numbers.
   - Path curve drawn with <mg.Stroke d="..." strokeWidth={6} color="#0066FF" durationFrames={36} />.
   - Area fill gradient underneath with linearGradient.
   - Glowing pen dot tracking current path head. Pinned callout pin at peak with <mg.Roll to={maxVal} />.

   ARCHETYPE D: CONNECTED SYSTEM NETWORK (NetworkMesh from Demo)
   - Layout: 6 to 8 node pills arranged in columns (e.g. Input, Planner, Workers, Validator) across 1500px width.
   - Curved SVG bezier connector paths (<path d="M... C..." fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={3} />).
   - Animated traveling pulse packets (<path d="..." stroke="#0066FF" strokeWidth={8} filter="url(#mgGlow)" strokeDasharray="0.08 2" strokeDashoffset={-((frame * 0.02) % 1)} />).
   - Sonar pulse rings around active nodes.

   ARCHETYPE E: BENTO METRIC GRID (BentoBadgeCluster from Demo)
   - Layout: 3 to 4 large styled metric blocks filling the screen (e.g. 2 top cards width: 680px, 1 wide bottom card width: 1400px).
   - Backgrounds in contrasting dark/light/accent colors, rounded corners (20px).
   - Large rolling numerals (<mg.Roll fontSize={110} />), progress rings, uppercase label tags.

   ARCHETYPE F: QUERY TRACE & TERMINAL (QueryTrace & MagnifierInspect from Demo)
   - Layout: Search/terminal input box with animated typing query: query.slice(0, Math.floor(frame * 0.8)).
   - 3 large cascading result cards (width: 1400px) flying in at frames 12, 18, 24 with confidence score bars and rank tags.

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
   - <mg.GridBackground mode="dark" /> : subtle grid lines on dark/light canvas (alias: <mg.Grid>)
   - <mg.Heading kicker="category" title="Headline" frameAt={2} style={{ position: "absolute", left: 100, top: 70 }} />
   - <mg.Card width={700} height={420} tilt={-2} mode="dark" frameAt={4}>{children}</mg.Card> : large floating UI card
   - <mg.FocusFrame frameAt={18} color="#FF5500" borderRadius={16}>{children}</mg.FocusFrame> : animated callout focus box (alias: <mg.Callout>)
   - <mg.WordCue cue={cue} emphasis={boolean} emphasisColor="#0066FF">{cue.text}</mg.WordCue> : voice-synced word reveal with subtle rise and blur
   - <mg.CueProgress cue={cue} width={240} color="#0066FF" /> : progress bar synced to word spoken duration
   - <mg.Roll to={number} from={0} fontSize={90} color="#fff" /> : animated rolling numeral
   - <mg.Stroke d="M..." width={w} height={h} color="#0066FF" durationFrames={36} /> : trim-path animated SVG path (alias: mg.Sweep)
   - <mg.CameraRig zoom={1.03} x={0} y={0}>{children}</mg.CameraRig> : camera pan/push container
   - <mg.ImpactLine text="Headline" frameAt={0} size={72} color="#fff" /> : bold kinetic text slam
   - <mg.Marker x={100} y={100} color="#0066FF" variant="cross" /> : architectural crosshair/dot marker
   - <mg.Noise opacity={0.035} /> : subtle procedural texture overlay

5. ALLOWED TAGS & ATTRIBUTES:
   - Standard SVG: <svg>, <g>, <path>, <rect>, <circle>, <ellipse>, <line>, <polyline>, <polygon>, <defs>, <marker>, <linearGradient>, <radialGradient>, <clipPath>, <mask>, <text>, <tspan>, <pattern>, <symbol>, <use>, <metadata>, <title>, <desc>
   - Standard HTML text: <div>, <span>, <p>, <h1>..<h6>, <code>, <pre>, <strong>, <em>, <ul>, <ol>, <li>
   - Absolutely NO external URLs (no http:// or https:// image links; render all visuals with SVG paths, gradients, shapes, or typography).
   - Absolutely NO browser globals: no window, document, fetch, localStorage, WebSocket, eval.

6. RETURN FORMAT:
   Return clean, valid TypeScript JSX. No markdown backticks inside the sourceCode string property.`;
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
    maxTokens: 16384,
  });
}
