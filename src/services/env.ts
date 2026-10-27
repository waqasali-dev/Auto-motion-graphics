// src/services/env.ts
// Centralized env reading — reads from Vite env with dual-route support
// Route 1: AgentRouter (https://agentrouter.org/v1)
// Route 2: HCNSEC API / Custom OpenAI route (https://api.hcnsec.cn/v1)
// Both endpoints can be configured simultaneously in .env.
// The active route is selectable via Settings dialog or VITE_ACTIVE_ROUTE in .env.

export type RouteId = "route1" | "route2";

export interface OpenAIEnv {
  apiKey: string;
  baseURL: string;
  model: string;
  plannerModel: string;
  reasoningEffort: string;
  maxOutputTokens?: number;
}

export interface AppSettings {
  activeRoute: RouteId;
  codeConcurrency: number;
  route1: OpenAIEnv;
  route2: OpenAIEnv;
}

const LS_KEY_ACTIVE_ROUTE = "frame60_active_route";
const LS_KEY_CONCURRENCY = "frame60_code_concurrency";
const LS_KEY_ROUTE1 = "frame60_route1_env";
const LS_KEY_ROUTE2 = "frame60_route2_env";
const LS_KEY_LEGACY = "frame60_openai_env";

function getMetaEnv(): Record<string, string> {
  const metaEnv = (import.meta as unknown as { env?: Record<string, string> }).env || {};
  const procEnv = typeof process !== "undefined" && (process as any).env ? (process as any).env : {};
  return { ...procEnv, ...metaEnv };
}

/** Get default config for Route 1 (AgentRouter) from .env */
export function getRoute1Default(): OpenAIEnv {
  const env = getMetaEnv();
  const apiKey =
    env.VITE_OPENAI_API_KEY ||
    env.VITE_AGENTROUTER_API_KEY ||
    env.OPENAI_API_KEY ||
    env.AGENTROUTER_API_KEY ||
    "";
  const baseURL =
    env.VITE_OPENAI_BASE_URL ||
    env.VITE_AGENTROUTER_BASE_URL ||
    env.OPENAI_BASE_URL ||
    env.AGENTROUTER_BASE_URL ||
    "https://agentrouter.org/v1";
  const model =
    env.VITE_OPENAI_MODEL ||
    env.VITE_AGENTROUTER_MODEL ||
    env.OPENAI_MODEL ||
    env.AGENTROUTER_MODEL ||
    "gpt-6-astra";
  const plannerModel =
    env.VITE_OPENAI_PLANNER_MODEL ||
    env.OPENAI_PLANNER_MODEL ||
    "gpt-4o-2024-08-06";
  const reasoningEffort =
    env.VITE_OPENAI_REASONING_EFFORT ||
    env.OPENAI_REASONING_EFFORT ||
    env.AGENTROUTER_REASONING_EFFORT ||
    "none";

  return { apiKey, baseURL, model, plannerModel, reasoningEffort };
}

/** Get default config for Route 2 (HCNSEC API) from .env */
export function getRoute2Default(): OpenAIEnv {
  const env = getMetaEnv();
  const apiKey =
    env.NEW_API_KEY ||
    env.VITE_NEW_API_KEY ||
    "";
  const baseURL =
    env.NEW_API_BASE_URL ||
    env.VITE_NEW_API_BASE_URL ||
    "https://api.hcnsec.cn/v1";
  const model =
    env.NEW_API_MODEL ||
    env.VITE_NEW_API_MODEL ||
    "glm-5.3";
  const plannerModel = model;
  const reasoningEffort = "none";
  const maxOutputTokens =
    Number(env.NEW_API_MAX_TOKENS || env.VITE_NEW_API_MAX_TOKENS || 0) || undefined;

  return { apiKey, baseURL, model, plannerModel, reasoningEffort, maxOutputTokens };
}

/** Determine which route is currently active (route1 or route2) */
export function getActiveRoute(): RouteId {
  try {
    const stored = localStorage.getItem(LS_KEY_ACTIVE_ROUTE);
    if (stored === "route1" || stored === "route2") {
      return stored;
    }
  } catch {}

  const env = getMetaEnv();
  const envRoute = (env.VITE_ACTIVE_ROUTE || "").toLowerCase().trim();
  if (envRoute === "route1" || envRoute === "route2") {
    return envRoute as RouteId;
  }

  // Fallback: If Route 2 has a valid non-placeholder key, default to Route 2; otherwise Route 1
  const route2Def = getRoute2Default();
  if (route2Def.apiKey && !route2Def.apiKey.startsWith("your_")) {
    return "route2";
  }
  return "route1";
}

/** Switch active route (turns on the chosen route, turns off the other) */
export function setActiveRoute(route: RouteId) {
  try {
    localStorage.setItem(LS_KEY_ACTIVE_ROUTE, route);
  } catch {}
}

/** How many concurrent agents should generate Remotion code simultaneously */
export function getCodeConcurrency(): number {
  try {
    const stored = localStorage.getItem(LS_KEY_CONCURRENCY);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= 12) {
        return parsed;
      }
    }
  } catch {}

  const env = getMetaEnv();
  const envConcurrency = parseInt(env.VITE_CODE_CONCURRENCY || "2", 10);
  if (!isNaN(envConcurrency) && envConcurrency >= 1 && envConcurrency <= 12) {
    return envConcurrency;
  }
  return 2;
}

export function setCodeConcurrency(concurrency: number) {
  try {
    const clamped = Math.max(1, Math.min(12, Math.round(concurrency)));
    localStorage.setItem(LS_KEY_CONCURRENCY, String(clamped));
  } catch {}
}

/** Get stored or default OpenAIEnv for a specific route */
export function getRouteEnv(route: RouteId): OpenAIEnv {
  const defaults = route === "route1" ? getRoute1Default() : getRoute2Default();
  const storageKey = route === "route1" ? LS_KEY_ROUTE1 : LS_KEY_ROUTE2;

  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<OpenAIEnv>;
      return {
        ...defaults,
        ...parsed,
      };
    }
    // Check legacy storage key if active route matches
    if (route === getActiveRoute()) {
      const legacy = localStorage.getItem(LS_KEY_LEGACY);
      if (legacy) {
        const parsed = JSON.parse(legacy) as Partial<OpenAIEnv>;
        return { ...defaults, ...parsed };
      }
    }
  } catch {}

  return defaults;
}

/** Save updated config for a specific route */
export function setRouteEnv(route: RouteId, patch: Partial<OpenAIEnv>) {
  const current = getRouteEnv(route);
  const next = { ...current, ...patch };
  const storageKey = route === "route1" ? LS_KEY_ROUTE1 : LS_KEY_ROUTE2;
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {}
  return next;
}

/** Returns the active route's environment config */
export function getEnv(): OpenAIEnv {
  return getRouteEnv(getActiveRoute());
}

/** Updates the active route's config */
export function setEnv(patch: Partial<OpenAIEnv>) {
  const active = getActiveRoute();
  const updated = setRouteEnv(active, patch);
  try {
    localStorage.setItem(LS_KEY_LEGACY, JSON.stringify(updated));
  } catch {}
  return updated;
}

export function hasValidKey(): boolean {
  const { apiKey } = getEnv();
  return !!apiKey && (apiKey.startsWith("sk-") || apiKey.length > 10);
}

/** Returns true ONLY if the active route is pointing to AgentRouter (https://agentrouter.org). */
export function isAgentRouter(targetEnv?: OpenAIEnv): boolean {
  if (targetEnv) {
    const base = (targetEnv.baseURL || "").toLowerCase();
    return base.includes("agentrouter.org");
  }
  const env = getEnv();
  const base = (env.baseURL || "").toLowerCase();
  return base.includes("agentrouter.org") || getActiveRoute() === "route1";
}

/**
 * Returns the effective base URL for fetch/OpenAI calls.
 * If running in a browser:
 * - agentrouter.org routes via /agentrouter-proxy/v1
 */
export function getEffectiveBaseURL(): string {
  const env = getEnv();
  const rawUrl = env.baseURL || "https://agentrouter.org/v1";
  const trimmed = rawUrl.replace(/\/+$/, "");
  const formatted = trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;

  if (typeof window !== "undefined") {
    if (formatted.includes("agentrouter.org")) {
      return `${window.location.origin}/agentrouter-proxy/v1`;
    }
  }
  return formatted;
}

export function getEnvStatus(): {
  configured: boolean;
  model: string;
  baseURL: string;
  keyPreview: string;
  routeName: string;
  activeRoute: RouteId;
  codeConcurrency: number;
} {
  const env = getEnv();
  const activeRoute = getActiveRoute();
  const isAgent = isAgentRouter();
  const routeName = isAgent
    ? "AgentRouter (Route 1)"
    : env.baseURL.includes("hcnsec")
      ? "HCNSEC (Route 2)"
      : "OpenAI Custom";

  return {
    configured: hasValidKey(),
    model: env.model,
    baseURL: env.baseURL,
    routeName,
    activeRoute,
    codeConcurrency: getCodeConcurrency(),
    keyPreview: env.apiKey ? `${env.apiKey.slice(0, 7)}...${env.apiKey.slice(-4)}` : "not set",
  };
}
