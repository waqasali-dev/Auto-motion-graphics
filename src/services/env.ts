// src/services/env.ts
// Centralized env reading — reads from Vite env with localStorage override
// User can configure via Settings UI, which persists to localStorage and
// takes precedence over .env values.

export interface OpenAIEnv {
  apiKey: string;
  baseURL: string;
  model: string;
  plannerModel: string;
  reasoningEffort: string;
}

const LS_KEY = "frame60_openai_env";

export function getEnv(): OpenAIEnv {
  const metaEnv = (import.meta as unknown as { env?: Record<string, string> }).env || {};

  const fileKey =
    metaEnv.VITE_OPENAI_API_KEY ||
    metaEnv.VITE_AGENTROUTER_API_KEY ||
    metaEnv.OPENAI_API_KEY ||
    metaEnv.AGENTROUTER_API_KEY ||
    "";

  const fileBase =
    metaEnv.VITE_OPENAI_BASE_URL ||
    metaEnv.VITE_AGENTROUTER_BASE_URL ||
    metaEnv.OPENAI_BASE_URL ||
    metaEnv.AGENTROUTER_BASE_URL ||
    "https://agentrouter.org/v1";

  const fileModel =
    metaEnv.VITE_OPENAI_MODEL ||
    metaEnv.VITE_AGENTROUTER_MODEL ||
    metaEnv.OPENAI_MODEL ||
    metaEnv.AGENTROUTER_MODEL ||
    "gpt-6.1-sol";

  const filePlannerModel =
    metaEnv.VITE_OPENAI_PLANNER_MODEL ||
    metaEnv.OPENAI_PLANNER_MODEL ||
    fileModel;

  const fileReasoning =
    metaEnv.VITE_OPENAI_REASONING_EFFORT ||
    metaEnv.OPENAI_REASONING_EFFORT ||
    metaEnv.AGENTROUTER_REASONING_EFFORT ||
    "none";

  // localStorage override wins
  try {
    const stored = localStorage.getItem(LS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<OpenAIEnv>;
      if (parsed.apiKey || parsed.baseURL || parsed.model) {
        return {
          apiKey: parsed.apiKey || fileKey,
          baseURL: parsed.baseURL || fileBase,
          model: parsed.model || fileModel,
          plannerModel: parsed.plannerModel || parsed.model || filePlannerModel,
          reasoningEffort: parsed.reasoningEffort || fileReasoning,
        };
      }
    }
  } catch {}

  return {
    apiKey: fileKey,
    baseURL: fileBase,
    model: fileModel,
    plannerModel: filePlannerModel,
    reasoningEffort: fileReasoning,
  };
}

export function setEnv(patch: Partial<OpenAIEnv>) {
  const current = getEnv();
  const next = { ...current, ...patch };
  localStorage.setItem(LS_KEY, JSON.stringify(next));
  return next;
}

export function hasValidKey(): boolean {
  const { apiKey } = getEnv();
  return !!apiKey && (apiKey.startsWith("sk-") || apiKey.length > 15);
}

export function isAgentRouter(): boolean {
  const env = getEnv();
  const base = (env.baseURL || "").toLowerCase();
  const model = (env.model || "").toLowerCase();
  return base.includes("agentrouter.org") || model.includes("sol") || model.includes("astra");
}

/**
 * Returns the effective base URL for fetch/OpenAI calls.
 * If running in a browser and pointing to agentrouter.org, routes via the Vite
 * proxy endpoint (/agentrouter-proxy/v1) which injects the required CLI User-Agent headers
 * to prevent 401 unauthorized client errors.
 */
export function getEffectiveBaseURL(): string {
  const env = getEnv();
  const rawUrl = env.baseURL || "https://agentrouter.org/v1";
  const trimmed = rawUrl.replace(/\/+$/, "");
  const formatted = trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;

  if (typeof window !== "undefined" && formatted.includes("agentrouter.org")) {
    return `${window.location.origin}/agentrouter-proxy/v1`;
  }
  return formatted;
}

export function getEnvStatus(): { configured: boolean; model: string; baseURL: string; keyPreview: string } {
  const env = getEnv();
  return {
    configured: hasValidKey(),
    model: env.model,
    baseURL: env.baseURL,
    keyPreview: env.apiKey ? `${env.apiKey.slice(0, 7)}...${env.apiKey.slice(-4)}` : "not set",
  };
}

