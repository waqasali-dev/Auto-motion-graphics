// src/components/SettingsDialog.tsx
// OpenAI env config — .env + localStorage override + in-UI editor

import { useState } from "react";
import { getEnv, setEnv, getEnvStatus } from "../services/env";
import { getClient, resetClient } from "../services/openai";
import { X, Eye, EyeOff, CheckCircle2, AlertCircle, ExternalLink, Copy } from "lucide-react";

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [env, setEnvState] = useState(() => getEnv());
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const status = getEnvStatus();

  if (!open) return null;

  const handleSave = () => {
    setEnv(env);
    resetClient();
    onClose();
    // soft reload to pick up new env in all hooks
    window.location.reload();
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const client = getClient();
      if (!client) throw new Error("No API key configured");
      // lightweight models.list check
      await client.models.list();
      setTestResult({ ok: true, msg: `Connected — model ${env.model} ready` });
    } catch (e) {
      setTestResult({ ok: false, msg: (e as Error).message.slice(0, 180) });
    } finally {
      setTesting(false);
    }
  };

  const copyEnvExample = async () => {
    const snippet = `VITE_OPENAI_API_KEY=${env.apiKey}\nVITE_OPENAI_BASE_URL=${env.baseURL}\nVITE_OPENAI_MODEL=${env.model}`;
    await navigator.clipboard.writeText(snippet);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[color:var(--color-surface)] rounded-2xl max-w-[560px] w-full max-h-[90vh] overflow-auto shadow-2xl">
        <div className="sticky top-0 bg-[color:var(--color-surface)] border-b border-[color:var(--color-border)] px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-lg">OpenAI Settings</h3>
            <p className="text-xs text-[color:var(--color-text-faint)]">Stored locally — never sent to our servers · You own your key</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-[color:var(--color-surface-3)]"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-4">
          {/* Status */}
          <div className={`rounded-xl p-3 flex gap-3 border ${status.configured ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
            {status.configured ? <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" /> : <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />}
            <div className="text-sm">
              <div className={`font-semibold ${status.configured ? "text-emerald-800" : "text-amber-800"}`}>{status.configured ? "LLM Ready" : "Deterministic Fallback Active"}</div>
              <div className="text-[color:var(--color-text-soft)] text-xs mt-0.5">
                {status.configured ? `${status.model} @ ${status.baseURL} · ${status.keyPreview}` : "Add your API key to enable LLM Shot planning, ASR cleanup, and Whisper transcription. App works without it via deterministic planner."}
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold tracking-widest uppercase text-[color:var(--color-text-soft)]">API Key</label>
            <div className="relative mt-1">
              <input
                type={showKey ? "text" : "password"}
                value={env.apiKey}
                onChange={(e) => setEnvState({ ...env, apiKey: e.target.value })}
                placeholder="sk-proj-..."
                className="w-full pr-20 pl-3 py-2.5 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-2)] text-sm font-mono focus:outline-none focus:border-[#0066FF]/40 focus:bg-[color:var(--color-surface)]"
              />
              <button onClick={() => setShowKey((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg hover:bg-[color:var(--color-surface-3)]">
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[11px] text-[color:var(--color-text-faint)] mt-1">Or set <code className="px-1 py-0.5 bg-[color:var(--color-surface-3)] rounded">VITE_OPENAI_API_KEY</code> in your <code className="px-1 py-0.5 bg-[color:var(--color-surface-3)] rounded">.env</code> — localStorage override wins.</p>
          </div>

          <div>
            <label className="text-xs font-semibold tracking-widest uppercase text-[color:var(--color-text-soft)]">Base URL</label>
            <input value={env.baseURL} onChange={(e) => setEnvState({ ...env, baseURL: e.target.value })} placeholder="https://api.openai.com/v1" className="w-full mt-1 px-3 py-2.5 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-2)] text-sm font-mono focus:outline-none focus:border-[#0066FF]/40 focus:bg-[color:var(--color-surface)]" />
            <p className="text-[11px] text-[color:var(--color-text-faint)] mt-1">Use a proxy or compatible API: <code className="px-1 py-0.5 bg-[color:var(--color-surface-3)] rounded">https://your-proxy/v1</code></p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold tracking-widest uppercase text-[color:var(--color-text-soft)]">Model</label>
              <input value={env.model} onChange={(e) => setEnvState({ ...env, model: e.target.value })} placeholder="gpt-4o-mini" className="w-full mt-1 px-3 py-2.5 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-2)] text-sm font-mono focus:outline-none focus:border-[#0066FF]/40 focus:bg-[color:var(--color-surface)]" />
            </div>
            <div>
              <label className="text-xs font-semibold tracking-widest uppercase text-[color:var(--color-text-soft)]">Planner Model (optional)</label>
              <input value={env.plannerModel} onChange={(e) => setEnvState({ ...env, plannerModel: e.target.value })} placeholder="defaults to Model" className="w-full mt-1 px-3 py-2.5 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-2)] text-sm font-mono focus:outline-none focus:border-[#0066FF]/40 focus:bg-[color:var(--color-surface)]" />
            </div>
          </div>

          <div className="bg-zinc-900 text-zinc-200 rounded-xl p-3 font-mono text-xs">
            <div className="flex justify-between items-center mb-2">
              <span className="opacity-60">.env template</span>
              <button onClick={copyEnvExample} className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-xs flex items-center gap-1"><Copy className="w-3 h-3" /> Copy</button>
            </div>
            <div>VITE_OPENAI_API_KEY=sk-proj-...<br />VITE_OPENAI_BASE_URL=https://api.openai.com/v1<br />VITE_OPENAI_MODEL=gpt-4o-mini</div>
          </div>

          {testResult && (
            <div className={`rounded-xl p-3 text-sm flex gap-2 border ${testResult.ok ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-700"}`}>
              {testResult.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
              <span className="text-xs">{testResult.msg}</span>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={handleTest} disabled={testing || !env.apiKey} className="flex-1 py-2.5 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] hover:bg-[color:var(--color-surface-3)] text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2">
              {testing ? <span className="w-4 h-4 border-2 border-zinc-300 border-t-zinc-900 rounded-full animate-spin" /> : <ExternalLink className="w-4 h-4" />} Test Connection
            </button>
            <button onClick={handleSave} className="flex-1 py-2.5 rounded-xl bg-[#111827] hover:bg-black text-white text-sm font-semibold">Save & Reload</button>
          </div>

          <div className="text-[11px] text-[color:var(--color-text-faint)] leading-relaxed border-t border-[color:var(--color-border)] pt-3">
            Your key is stored only in this browser (localStorage) and sent directly to the provider via <code className="px-1 bg-[color:var(--color-surface-3)] rounded">openai</code> SDK — we never proxy or log it. Use a restricted key with appropriate rate limits.
          </div>
        </div>
      </div>
    </div>
  );
}
