// src/components/SettingsDialog.tsx
// OpenAI & LLM Engine Settings — Dual-Route Toggle, Concurrency, and Credentials Manager

import { useState } from "react";
import {
  getActiveRoute,
  setActiveRoute,
  getCodeConcurrency,
  setCodeConcurrency,
  getRouteEnv,
  setRouteEnv,
  RouteId,
  OpenAIEnv,
} from "../services/env";
import { resetClient, testEndpointConnection } from "../services/openai";
import {
  X,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Zap,
  Check,
  Server,
  Minus,
  Plus,
} from "lucide-react";

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [activeRoute, setActiveRouteState] = useState<RouteId>(() => getActiveRoute());
  const [route1, setRoute1] = useState<OpenAIEnv>(() => getRouteEnv("route1"));
  const [route2, setRoute2] = useState<OpenAIEnv>(() => getRouteEnv("route2"));
  const [concurrency, setConcurrency] = useState<number>(() => getCodeConcurrency());
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  if (!open) return null;

  const currentEnv = activeRoute === "route1" ? route1 : route2;

  const updateCurrentEnv = (patch: Partial<OpenAIEnv>) => {
    if (activeRoute === "route1") {
      setRoute1((prev) => ({ ...prev, ...patch }));
    } else {
      setRoute2((prev) => ({ ...prev, ...patch }));
    }
  };

  const handleSelectRoute = (route: RouteId) => {
    setActiveRouteState(route);
    setTestResult(null);
  };

  const handleSave = () => {
    setActiveRoute(activeRoute);
    setRouteEnv("route1", route1);
    setRouteEnv("route2", route2);
    setCodeConcurrency(concurrency);
    resetClient();
    onClose();
    // Soft reload to reinitialize client and state across all services
    window.location.reload();
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const targetEnv = activeRoute === "route1" ? route1 : route2;
      const res = await testEndpointConnection(targetEnv, activeRoute === "route1");
      setTestResult(res);
    } catch (e) {
      setTestResult({ ok: false, msg: (e as Error).message.slice(0, 200) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[color:var(--color-surface)] rounded-2xl max-w-[620px] w-full max-h-[92vh] overflow-y-auto shadow-2xl border border-[color:var(--color-border)]">
        {/* Sticky Header */}
        <div className="sticky top-0 z-10 bg-[color:var(--color-surface)] border-b border-[color:var(--color-border)] px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#0066FF]/10 text-[#0066FF] flex items-center justify-center">
              <Server className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-base text-[color:var(--color-text)]">Engine & Model Settings</h3>
              <p className="text-xs text-[color:var(--color-text-faint)]">Dual Endpoint Toggle · Concurrency · API Credentials</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-[color:var(--color-surface-3)] text-[color:var(--color-text-soft)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Section 1: Dual Endpoint Selector (Turn ON one, Turn OFF the other) */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold tracking-wider uppercase text-[color:var(--color-text-soft)]">
                Active LLM Endpoint
              </label>
              <span className="text-[11px] text-[color:var(--color-text-faint)]">
                One endpoint is active; the other stays on standby
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Route 1: AgentRouter */}
              <button
                type="button"
                onClick={() => handleSelectRoute("route1")}
                className={`relative p-3.5 rounded-xl border text-left transition-all flex flex-col justify-between ${
                  activeRoute === "route1"
                    ? "bg-[#0066FF]/5 border-[#0066FF] shadow-sm ring-1 ring-[#0066FF]/30"
                    : "bg-[color:var(--color-surface-2)] border-[color:var(--color-border)] hover:border-zinc-400 opacity-75 hover:opacity-100"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${
                        activeRoute === "route1"
                          ? "border-[#0066FF] bg-[#0066FF]"
                          : "border-zinc-400 bg-transparent"
                      }`}
                    >
                      {activeRoute === "route1" && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                    <span className="font-semibold text-xs text-[color:var(--color-text)]">
                      Route 1: AgentRouter
                    </span>
                  </div>
                  {activeRoute === "route1" ? (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 flex items-center gap-1">
                      <Check className="w-2.5 h-2.5" /> Active
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-200/60 text-zinc-600">
                      Standby (Off)
                    </span>
                  )}
                </div>
                <div className="text-[11px] font-mono text-[color:var(--color-text-soft)] truncate">
                  agentrouter.org
                </div>
                <div className="text-[10px] text-[color:var(--color-text-faint)] mt-1 truncate">
                  Model: {route1.model || "gpt-6-astra"}
                </div>
              </button>

              {/* Route 2: HCNSEC API */}
              <button
                type="button"
                onClick={() => handleSelectRoute("route2")}
                className={`relative p-3.5 rounded-xl border text-left transition-all flex flex-col justify-between ${
                  activeRoute === "route2"
                    ? "bg-[#0066FF]/5 border-[#0066FF] shadow-sm ring-1 ring-[#0066FF]/30"
                    : "bg-[color:var(--color-surface-2)] border-[color:var(--color-border)] hover:border-zinc-400 opacity-75 hover:opacity-100"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${
                        activeRoute === "route2"
                          ? "border-[#0066FF] bg-[#0066FF]"
                          : "border-zinc-400 bg-transparent"
                      }`}
                    >
                      {activeRoute === "route2" && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                    <span className="font-semibold text-xs text-[color:var(--color-text)]">
                      Route 2: HCNSEC API
                    </span>
                  </div>
                  {activeRoute === "route2" ? (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 flex items-center gap-1">
                      <Check className="w-2.5 h-2.5" /> Active
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-200/60 text-zinc-600">
                      Standby (Off)
                    </span>
                  )}
                </div>
                <div className="text-[11px] font-mono text-[color:var(--color-text-soft)] truncate">
                  api.hcnsec.cn/v1
                </div>
                <div className="text-[10px] text-[color:var(--color-text-faint)] mt-1 truncate">
                  Model: {route2.model || "glm-5.3"}
                </div>
              </button>
            </div>
          </div>

          {/* Section 2: Concurrency Controls (Stage 4 Remotion Code Generation) */}
          <div className="p-4 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-2)] space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-500" />
                  <label className="text-xs font-bold tracking-wider uppercase text-[color:var(--color-text)]">
                    Concurrent Remotion Code Agents
                  </label>
                </div>
                <p className="text-xs text-[color:var(--color-text-faint)] mt-0.5">
                  How many parallel AI agents author Remotion TSX shot components simultaneously during Stage 4.
                </p>
              </div>

              {/* Stepper counter */}
              <div className="flex items-center gap-2 bg-[color:var(--color-surface)] border border-[color:var(--color-border)] rounded-xl px-2 py-1 shadow-sm">
                <button
                  type="button"
                  disabled={concurrency <= 1}
                  onClick={() => setConcurrency((c) => Math.max(1, c - 1))}
                  className="p-1 rounded hover:bg-[color:var(--color-surface-3)] text-[color:var(--color-text)] disabled:opacity-30"
                  title="Decrease concurrency"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="font-bold font-mono text-sm min-w-[28px] text-center text-[#0066FF]">
                  {concurrency}
                </span>
                <button
                  type="button"
                  disabled={concurrency >= 10}
                  onClick={() => setConcurrency((c) => Math.min(10, c + 1))}
                  className="p-1 rounded hover:bg-[color:var(--color-surface-3)] text-[color:var(--color-text)] disabled:opacity-30"
                  title="Increase concurrency"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Quick Preset Buttons */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {[
                { count: 1, label: "1 (Safe)" },
                { count: 2, label: "2 (Default)" },
                { count: 3, label: "3 (Fast)" },
                { count: 4, label: "4 (Fast+)" },
                { count: 6, label: "6 (Turbo)" },
                { count: 8, label: "8 (Max)" },
              ].map(({ count, label }) => (
                <button
                  key={count}
                  type="button"
                  onClick={() => setConcurrency(count)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                    concurrency === count
                      ? "bg-[#0066FF] text-white shadow-sm"
                      : "bg-[color:var(--color-surface)] text-[color:var(--color-text-soft)] border border-[color:var(--color-border)] hover:bg-[color:var(--color-surface-3)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="text-[11px] text-[color:var(--color-text-faint)] leading-relaxed">
              {concurrency === 1 && "💡 Sequential mode: Lowest API token throughput. Ideal if your API key has strict rate limits."}
              {concurrency === 2 && "💡 Balanced mode (Default): Good parallel speed without risk of hitting standard rate limits."}
              {concurrency >= 3 && concurrency <= 4 && "⚡ High speed mode: 2x–3x faster film generation. Ensure your model provider quota allows multi-request concurrency."}
              {concurrency >= 5 && "🚀 Turbo mode: Generates multiple shots in parallel. Best for high-tier API keys with high TPM/RPM limits."}
            </div>
          </div>

          {/* Section 3: Credentials & Model for the Active Route */}
          <div className="space-y-3.5 border-t border-[color:var(--color-border)] pt-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold tracking-wider uppercase text-[color:var(--color-text-soft)]">
                {activeRoute === "route1" ? "Route 1 (AgentRouter) Settings" : "Route 2 (HCNSEC API) Settings"}
              </span>
              <span className="text-[11px] font-mono text-[color:var(--color-text-faint)]">
                {activeRoute === "route1" ? "VITE_OPENAI_*" : "NEW_API_* / VITE_NEW_API_*"}
              </span>
            </div>

            {/* API Key */}
            <div>
              <label className="text-xs font-semibold text-[color:var(--color-text)]">API Key</label>
              <div className="relative mt-1">
                <input
                  type={showKey ? "text" : "password"}
                  value={currentEnv.apiKey}
                  onChange={(e) => updateCurrentEnv({ apiKey: e.target.value })}
                  placeholder={activeRoute === "route1" ? "sk-..." : "sk-..."}
                  className="w-full pr-20 pl-3 py-2.5 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-2)] text-sm font-mono focus:outline-none focus:border-[#0066FF]/60 focus:bg-[color:var(--color-surface)]"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg hover:bg-[color:var(--color-surface-3)] text-[color:var(--color-text-soft)]"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Base URL */}
            <div>
              <label className="text-xs font-semibold text-[color:var(--color-text)]">Base URL</label>
              <input
                value={currentEnv.baseURL}
                onChange={(e) => updateCurrentEnv({ baseURL: e.target.value })}
                placeholder={activeRoute === "route1" ? "https://agentrouter.org/v1" : "https://api.hcnsec.cn/v1"}
                className="w-full mt-1 px-3 py-2.5 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-2)] text-sm font-mono focus:outline-none focus:border-[#0066FF]/60 focus:bg-[color:var(--color-surface)]"
              />
            </div>

            {/* Model and Planner Model */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-[color:var(--color-text)]">Model</label>
                <input
                  value={currentEnv.model}
                  onChange={(e) => updateCurrentEnv({ model: e.target.value })}
                  placeholder={activeRoute === "route1" ? "gpt-6-astra" : "glm-5.3"}
                  className="w-full mt-1 px-3 py-2.5 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-2)] text-sm font-mono focus:outline-none focus:border-[#0066FF]/60 focus:bg-[color:var(--color-surface)]"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-[color:var(--color-text)]">Planner Model (Optional)</label>
                <input
                  value={currentEnv.plannerModel || ""}
                  onChange={(e) => updateCurrentEnv({ plannerModel: e.target.value })}
                  placeholder={activeRoute === "route1" ? "gpt-4o-2024-08-06" : "defaults to Model"}
                  className="w-full mt-1 px-3 py-2.5 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-2)] text-sm font-mono focus:outline-none focus:border-[#0066FF]/60 focus:bg-[color:var(--color-surface)]"
                />
              </div>
            </div>
          </div>

          {/* Test Connection Output */}
          {testResult && (
            <div
              className={`rounded-xl p-3 text-sm flex gap-2 border ${
                testResult.ok
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : "bg-red-50 border-red-200 text-red-700"
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              )}
              <span className="text-xs leading-relaxed">{testResult.msg}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2.5 pt-1">
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || !currentEnv.apiKey}
              className="flex-1 py-2.5 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] hover:bg-[color:var(--color-surface-3)] text-sm font-medium text-[color:var(--color-text)] disabled:opacity-40 flex items-center justify-center gap-2 transition-colors"
            >
              {testing ? (
                <span className="w-4 h-4 border-2 border-zinc-400 border-t-[#0066FF] rounded-full animate-spin" />
              ) : (
                <ExternalLink className="w-4 h-4 text-[color:var(--color-text-soft)]" />
              )}
              Test Active Endpoint
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="flex-1 py-2.5 rounded-xl bg-[#0066FF] hover:bg-[#0052cc] text-white text-sm font-semibold shadow-sm transition-colors flex items-center justify-center gap-1.5"
            >
              <Check className="w-4 h-4" /> Save & Apply
            </button>
          </div>

          <div className="text-[11px] text-[color:var(--color-text-faint)] leading-relaxed border-t border-[color:var(--color-border)] pt-3">
            Keys and concurrency settings are stored in local storage and sent directly to your provider via the OpenAI SDK. Switching the active route instantly toggles between Route 1 (AgentRouter) and Route 2 (HCNSEC).
          </div>
        </div>
      </div>
    </div>
  );
}
