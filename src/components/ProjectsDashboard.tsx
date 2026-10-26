// src/components/ProjectsDashboard.tsx
// Local-first project manager — no DB, no server. All in browser storage.

import { useEffect, useState } from "react";
import { getProjects, deleteProject, duplicateProject, setActiveProjectId, getActiveProjectId, formatDuration, type Project } from "../services/projects";
import { FilmStage } from "../mg/stage";
import { ARCHETYPE_REGISTRY } from "../sdk/registry";
import { GeneratedFilmPoster } from "./GeneratedFilmPlayer";
import { Plus, Trash2, Copy, Play, Clock, Layers, Sparkles, Film, Search, Download, Upload } from "lucide-react";

export function ProjectsDashboard({ onOpen, onCreateNew, refreshKey }: { onOpen: (id: string) => void; onCreateNew: () => void; refreshKey?: number }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [filter, setFilter] = useState("");

  const reload = () => setProjects(getProjects());
  useEffect(() => { reload(); }, [refreshKey]);
  useEffect(() => {
    const onStorage = () => reload();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const filtered = projects.filter((p) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return p.title.toLowerCase().includes(q) || p.transcriptText.toLowerCase().includes(q);
  });

  const activeId = getActiveProjectId();

  return (
    <div className="max-w-[1400px] mx-auto px-6 md:px-12 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <div className="font-mono text-[11px] tracking-[0.3em] uppercase text-[#0066FF]">Local Projects · No DB · In Browser</div>
          <h2 className="text-3xl font-bold tracking-tight mt-1">Your Films</h2>
          <p className="text-sm text-[color:var(--color-text-faint)] mt-1">All projects live in this browser. Audio is stored in IndexedDB, metadata in localStorage. Export a project to share it.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--color-text-faint)]" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search projects..." className="pl-9 pr-3 py-2 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-sm w-[220px] focus:outline-none focus:border-[#0066FF]/40" />
          </div>
          <label className="px-4 py-2 rounded-full bg-[color:var(--color-surface)] border border-[color:var(--color-border)] text-sm font-medium hover:bg-[color:var(--color-surface-3)] cursor-pointer flex items-center gap-2">
            <Upload className="w-4 h-4" /> Import
            <input type="file" accept=".json" hidden onChange={async (e) => {
              const f = e.target.files?.[0]; if (!f) return;
              try {
                const j = JSON.parse(await f.text());
                const imported = { ...j, id: `proj_${Date.now()}_${Math.random().toString(36).slice(2,4)}`, createdAt: Date.now(), updatedAt: Date.now() } as Project;
                const all = JSON.parse(localStorage.getItem("frame60_projects_v2") || "[]"); all.unshift(imported); localStorage.setItem("frame60_projects_v2", JSON.stringify(all)); reload();
              } catch {}
              e.target.value = "";
            }} />
          </label>
          <button onClick={onCreateNew} className="px-5 py-2.5 rounded-full bg-[#111827] text-white text-sm font-semibold flex items-center gap-2 hover:bg-black">
            <Plus className="w-4 h-4" /> New Film
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="border-2 border-dashed border-[color:var(--color-border)] rounded-2xl p-12 text-center bg-[color:var(--color-surface)]">
          <Film className="w-10 h-10 mx-auto text-[color:var(--color-text-faint)] mb-3" />
          <h3 className="font-semibold">No projects yet</h3>
          <p className="text-sm text-[color:var(--color-text-faint)] mt-1">Create your first film — upload audio + transcript and the 5-stage pipeline will build it.</p>
          <button onClick={onCreateNew} className="mt-4 px-5 py-2 rounded-full bg-[#0066FF] text-white text-sm font-semibold inline-flex items-center gap-2"><Sparkles className="w-4 h-4" /> Start a new film</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((p) => {
            const isActive = p.id === activeId;
            const hasFilm = (p.generatedFilm?.shots.length ?? 0) > 0 || p.shots.length > 0;
            const duration = p.audioDurationSec || 30;
            return (
              <div key={p.id} className={`bg-[color:var(--color-surface)] rounded-2xl border overflow-hidden flex flex-col hover:shadow-lg transition-shadow ${isActive ? "border-[#0066FF] ring-2 ring-[#0066FF]/20" : "border-[color:var(--color-border)]"}`}>
                {/* Preview */}
                <div className="h-[160px] bg-[#0B0D12] relative overflow-hidden">
                  {p.generatedFilm?.shots.length ? (
                    <div className="absolute inset-0 opacity-90">
                      <GeneratedFilmPoster film={p.generatedFilm} frame={Math.min(90, p.generatedFilm.durationInFrames - 1)} />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
                      <span className="absolute top-2 right-2 px-2 py-1 rounded bg-blue-600 text-white font-mono text-[9px] uppercase tracking-widest">AI-authored Remotion</span>
                    </div>
                  ) : hasFilm && p.shots[0] ? (
                    <div className="absolute inset-0 opacity-90">
                      {/* Show first shot still */}
                      <FilmStage shots={p.shots} frame={p.shots[0].startFrame + 30} registry={ARCHETYPE_REGISTRY} />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
                    </div>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Film className="w-10 h-10 text-[color:var(--color-text-soft)]" />
                    </div>
                  )}
                  <div className="absolute top-2 left-2 flex gap-1.5">
                    <span className={`px-2 py-1 rounded-full text-[11px] font-mono font-bold ${p.status === "ready" ? "bg-emerald-500 text-white" : p.status === "processing" ? "bg-amber-500 text-white" : p.status === "error" ? "bg-red-500 text-white" : "bg-zinc-700 text-zinc-200"}`}>{p.status}</span>
                    {p.usedLLM && <span className="px-2 py-1 rounded-full bg-[#0066FF] text-white text-[11px] font-mono">LLM</span>}
                  </div>
                  {hasFilm && (
                    <button onClick={() => { setActiveProjectId(p.id); onOpen(p.id); }} className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 bg-black/40 transition-opacity">
                      <span className="w-12 h-12 rounded-full bg-white text-zinc-900 flex items-center justify-center"><Play className="w-5 h-5 ml-0.5 fill-current" /></span>
                    </button>
                  )}
                </div>

                <div className="p-4 flex-1 flex flex-col">
                  <h3 className="font-semibold leading-tight line-clamp-1">{p.title}</h3>
                  <p className="text-xs text-[color:var(--color-text-faint)] mt-1 line-clamp-2">{p.transcriptText.slice(0, 120) || "No transcript"}</p>
                  <div className="flex items-center gap-3 mt-3 font-mono text-[11px] text-[color:var(--color-text-faint)]">
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {formatDuration(duration)}</span>
                    <span className="flex items-center gap-1"><Layers className="w-3 h-3" /> {p.shots.length ? `${p.shots.length} shots` : "—"}</span>
                    <span className="ml-auto">{new Date(p.updatedAt).toLocaleDateString()}</span>
                  </div>
                  <div className="flex gap-2 mt-4">
                    <button onClick={() => { setActiveProjectId(p.id); onOpen(p.id); }} className="flex-1 py-2 rounded-full bg-[#111827] text-white text-sm font-medium hover:bg-black">{hasFilm ? "Open Studio" : "Continue"}</button>
                    <button title="Duplicate" onClick={() => { const dup = duplicateProject(p.id); if (dup) reload(); }} className="p-2 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] hover:bg-[color:var(--color-surface-3)]"><Copy className="w-4 h-4" /></button>
                    <button title="Export JSON" onClick={() => { const blob = new Blob([JSON.stringify(p, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `${p.title.replace(/\s+/g,"_")}.json`; a.click(); URL.revokeObjectURL(url); }} className="p-2 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] hover:bg-[color:var(--color-surface-3)]"><Download className="w-4 h-4" /></button>
                    <button title="Delete" onClick={() => { if (confirm(`Delete "${p.title}"?`)) { deleteProject(p.id); reload(); } }} className="p-2 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] hover:bg-red-50 text-[color:var(--color-text-faint)] hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
