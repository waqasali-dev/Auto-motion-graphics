// src/services/projects.ts
// Local-first project management — zero DB, zero server
// Uses localStorage for metadata + IndexedDB for audio blobs (large files)

import type { Beat, PlannedShot, VarietyReport } from "../sdk/contract";
import type { FrameLockedShot, ValidationResult, RawTranscriptJSON } from "../sdk/contract.pipeline";
import type { GeneratedFilm } from "../sdk/contract.generated";

export type ProjectStatus = "draft" | "processing" | "ready" | "error";
export type PipelineStage = "1_preprocessor" | "2_planner" | "3_middleware" | "4_workers" | "5_validator";

export interface PipelineLog {
  stage: string;
  message: string;
  status: "running" | "success" | "error" | "skipped";
  timestamp: number;
  /** Full model working / raw trace. Shown only when the user expands a stage. */
  detail?: string;
}

export interface Project {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  status: ProjectStatus;

  // Input
  audioFileName?: string;
  audioUrl?: string; // object URL or data URL
  audioDurationSec: number;
  transcriptText: string;
  rawTranscript?: RawTranscriptJSON | null;

  // Pipeline output
  beats: Beat[];
  shots: PlannedShot[]; // generated via variety planner from beats (preserves quality)
  frameLocked: FrameLockedShot[]; // raw frame-lock from spec middleware
  varietyReport?: VarietyReport | null;
  // User-created videos are model-authored Remotion scenes, not archetype instances.
  generatedFilm?: GeneratedFilm | null;
  pipelineDraft?: GeneratedFilm | null;
  failedStage?: string | null;
  renderedVideoBlobKey?: string | null;
  validation: ValidationResult[];
  pipelineLogs: PipelineLog[];
  usedLLM: boolean;

  // Settings snapshot
  templateLocked: boolean; // true = locked SDK quality guarantee
}

const LS_KEY = "frame60_projects_v2";
const LS_ACTIVE = "frame60_active_project";

// ──────────────────────────────────────────────────────────────────────────────
// IndexedDB for audio blobs & full Project JSON (localStorage 5MB limit workaround)
// ──────────────────────────────────────────────────────────────────────────────

const DB_NAME = "frame60_storage_v1";
const DB_VERSION = 1;
const STORE_BLOBS = "blobs";
const STORE_PROJECTS = "projects";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_BLOBS)) db.createObjectStore(STORE_BLOBS);
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) db.createObjectStore(STORE_PROJECTS, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveProjectToIDB(project: Project): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE_PROJECTS, "readwrite");
      tx.objectStore(STORE_PROJECTS).put(project);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch (err) {
    console.error("Failed to save project to IndexedDB:", err);
  }
}

export async function loadProjectFromIDB(id: string): Promise<Project | null> {
  try {
    const db = await openDB();
    const proj = await new Promise<Project | null>((res) => {
      const tx = db.transaction(STORE_PROJECTS, "readonly");
      const req = tx.objectStore(STORE_PROJECTS).get(id);
      req.onsuccess = () => res((req.result as Project) || null);
      req.onerror = () => res(null);
    });
    db.close();
    return proj;
  } catch {
    return null;
  }
}

export async function loadAllProjectsFromIDB(): Promise<Project[]> {
  try {
    const db = await openDB();
    const list = await new Promise<Project[]>((res) => {
      const tx = db.transaction(STORE_PROJECTS, "readonly");
      const req = tx.objectStore(STORE_PROJECTS).getAll();
      req.onsuccess = () => res((req.result as Project[]) || []);
      req.onerror = () => res([]);
    });
    db.close();
    return list;
  } catch {
    return [];
  }
}

export async function deleteProjectFromIDB(id: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((res) => {
      const tx = db.transaction(STORE_PROJECTS, "readwrite");
      tx.objectStore(STORE_PROJECTS).delete(id);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
    db.close();
  } catch {}
}

export async function saveAudioBlob(projectId: string, blob: Blob): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE_BLOBS, "readwrite");
      tx.objectStore(STORE_BLOBS).put(blob, projectId);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch {
    // fallback
  }
  // Store directly to disk in projects/${projectId}_audio.*
  await saveAudioToDisk(projectId, blob);
}

export async function saveRenderBlob(projectId: string, blob: Blob): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE_BLOBS, "readwrite");
      tx.objectStore(STORE_BLOBS).put(blob, `render:${projectId}`);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch {}
}

export async function loadRenderBlob(projectId: string): Promise<Blob | null> {
  try {
    const db = await openDB();
    const blob = await new Promise<Blob | null>((res) => {
      const tx = db.transaction(STORE_BLOBS, "readonly");
      const req = tx.objectStore(STORE_BLOBS).get(`render:${projectId}`);
      req.onsuccess = () => res((req.result as Blob) || null);
      req.onerror = () => res(null);
    });
    db.close();
    return blob;
  } catch {
    return null;
  }
}

export async function loadAudioBlob(projectId: string): Promise<Blob | null> {
  try {
    const db = await openDB();
    let blob = await new Promise<Blob | null>((res) => {
      const tx = db.transaction(STORE_BLOBS, "readonly");
      const req = tx.objectStore(STORE_BLOBS).get(projectId);
      req.onsuccess = () => res((req.result as Blob) || null);
      req.onerror = () => res(null);
    });
    db.close();
    if (blob) return blob;
  } catch {}

  // Check disk storage in projects/
  const diskBlob = await fetchAudioFromDisk(projectId);
  if (diskBlob) {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_BLOBS, "readwrite");
      tx.objectStore(STORE_BLOBS).put(diskBlob, projectId);
      db.close();
    } catch {}
    return diskBlob;
  }

  // Check legacy DB if needed
  try {
    const legacyDB = await new Promise<IDBDatabase>((res, rej) => {
      const req = indexedDB.open("frame60_audio", 1);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej();
    });
    const blob = await new Promise<Blob | null>((res) => {
      const tx = legacyDB.transaction("blobs", "readonly");
      const req = tx.objectStore("blobs").get(projectId);
      req.onsuccess = () => res((req.result as Blob) || null);
      req.onerror = () => res(null);
    });
    legacyDB.close();
    if (blob) {
      await saveAudioBlob(projectId, blob);
    }
    return blob;
  } catch {
    return null;
  }
}

export async function deleteAudioBlob(projectId: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((res) => {
      const tx = db.transaction(STORE_BLOBS, "readwrite");
      tx.objectStore(STORE_BLOBS).delete(projectId);
      tx.objectStore(STORE_BLOBS).delete(`render:${projectId}`);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
    db.close();
  } catch {}
}

// ──────────────────────────────────────────────────────────────────────────────
// Disk Sync API client (Vite backend plugin -> projects/*.json)
// ──────────────────────────────────────────────────────────────────────────────

export async function syncProjectToDisk(project: Project): Promise<void> {
  try {
    await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(project),
    });
  } catch (err) {
    console.warn("Failed to sync project to disk:", err);
  }
}

export async function fetchProjectFromDisk(id: string): Promise<Project | null> {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    return (await res.json()) as Project;
  } catch {
    return null;
  }
}

export async function fetchAllProjectsFromDisk(): Promise<Project[]> {
  try {
    const res = await fetch("/api/projects");
    if (!res.ok) return [];
    return (await res.json()) as Project[];
  } catch {
    return [];
  }
}

export async function deleteProjectFromDisk(id: string): Promise<void> {
  try {
    await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {}
}

export async function saveAudioToDisk(projectId: string, blob: Blob): Promise<void> {
  try {
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/audio`, {
      method: "POST",
      headers: { "Content-Type": blob.type || "audio/mpeg" },
      body: blob,
    });
  } catch (err) {
    console.warn("Failed to stream audio to disk:", err);
  }
}

export async function fetchAudioFromDisk(projectId: string): Promise<Blob | null> {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/audio`);
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

export async function saveActiveProjectIdToDisk(id: string | null): Promise<void> {
  try {
    await fetch("/api/active-project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activeId: id }),
    });
  } catch {}
}

export async function fetchActiveProjectIdFromDisk(): Promise<string | null> {
  try {
    const res = await fetch("/api/active-project");
    if (!res.ok) return null;
    const data = await res.json();
    return data?.activeId || null;
  } catch {
    return null;
  }
}

/**
 * Hydrates repository projects from disk into memory, localStorage and IndexedDB.
 * Returns the resolved active project ID (either restored active or latest project).
 */
export async function initProjectsSync(): Promise<string | null> {
  try {
    const diskProjects = await fetchAllProjectsFromDisk();
    const local = loadAll();
    const idbProjects = await loadAllProjectsFromIDB();

    const mergedMap = new Map<string, Project>();
    for (const p of local) mergedMap.set(p.id, p);
    for (const p of idbProjects) mergedMap.set(p.id, p);
    for (const p of diskProjects) {
      const existing = mergedMap.get(p.id);
      if (!existing || (p.updatedAt || 0) >= (existing.updatedAt || 0)) {
        mergedMap.set(p.id, p);
      }
    }

    const all = Array.from(mergedMap.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    saveAll(all);

    for (const p of all) {
      void saveProjectToIDB(p);
      if (!diskProjects.some((dp) => dp.id === p.id)) {
        void syncProjectToDisk(p);
      }
    }

    let activeId = await fetchActiveProjectIdFromDisk();
    if (!activeId || !all.some((p) => p.id === activeId)) {
      activeId = getActiveProjectId();
    }
    if (!activeId || !all.some((p) => p.id === activeId)) {
      activeId = all[0]?.id || null;
    }

    if (activeId) {
      setActiveProjectId(activeId);
      void saveActiveProjectIdToDisk(activeId);
    }

    return activeId;
  } catch (err) {
    console.warn("initProjectsSync error:", err);
    return getActiveProjectId();
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Project CRUD (Repository disk JSON files + fast local cache)
// ──────────────────────────────────────────────────────────────────────────────

function loadAll(): Project[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Project[];
  } catch {
    return [];
  }
}

function compactProject(p: Project): Project {
  // If draft or film is huge, keep metadata, shot list structure and visual summaries,
  // but strip large repeated sourceCode in localStorage so it never hits the 5MB browser quota.
  // Full lossless sourceCode and AST are safely preserved in projects/*.json on disk!
  return {
    ...p,
    pipelineDraft: p.pipelineDraft ? {
      ...p.pipelineDraft,
      shots: p.pipelineDraft.shots.map((s) => ({
        ...s,
        sourceCode: s.sourceCode && s.sourceCode.length > 500 ? "" : s.sourceCode,
      })),
    } : null,
    generatedFilm: p.generatedFilm ? {
      ...p.generatedFilm,
      shots: p.generatedFilm.shots.map((s) => ({
        ...s,
        sourceCode: s.sourceCode && s.sourceCode.length > 500 ? "" : s.sourceCode,
      })),
    } : null,
  };
}

function saveAll(projects: Project[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(projects));
  } catch {
    try {
      const compact = projects.map(compactProject);
      localStorage.setItem(LS_KEY, JSON.stringify(compact));
    } catch (e2) {
      console.warn("localStorage quota exceeded; disk and IndexedDB hold primary state.", e2);
    }
  }
}

export function getProjects(): Project[] {
  return loadAll().sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProjectsAsync(): Promise<Project[]> {
  const disk = await fetchAllProjectsFromDisk();
  if (disk.length > 0) {
    saveAll(disk);
    return disk;
  }
  return getProjects();
}

export function getProject(id: string): Project | null {
  return loadAll().find((p) => p.id === id) ?? null;
}

export async function getProjectAsync(id: string): Promise<Project | null> {
  // 1. Check disk first for lossless project JSON
  const fromDisk = await fetchProjectFromDisk(id);
  if (fromDisk) {
    const all = loadAll();
    const idx = all.findIndex((p) => p.id === id);
    if (idx >= 0) all[idx] = fromDisk;
    else all.unshift(fromDisk);
    saveAll(all);
    void saveProjectToIDB(fromDisk);
    return fromDisk;
  }

  // 2. Check IndexedDB
  const fromIDB = await loadProjectFromIDB(id);
  if (fromIDB) {
    void syncProjectToDisk(fromIDB);
    return fromIDB;
  }

  // 3. Fallback to localStorage
  const fromLS = getProject(id);
  if (fromLS) {
    void syncProjectToDisk(fromLS);
  }
  return fromLS;
}

export function createProject(opts: { title: string; transcriptText?: string; audioFileName?: string; audioDurationSec?: number; audioUrl?: string; rawTranscript?: RawTranscriptJSON | null }): Project {
  const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const project: Project = {
    id,
    title: opts.title || `Untitled ${new Date().toLocaleDateString()}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "draft",
    audioFileName: opts.audioFileName,
    audioUrl: opts.audioUrl,
    audioDurationSec: opts.audioDurationSec ?? 30,
    transcriptText: opts.transcriptText ?? "",
    rawTranscript: opts.rawTranscript ?? null,
    beats: [],
    shots: [],
    frameLocked: [],
    varietyReport: null,
    generatedFilm: null,
    pipelineDraft: null,
    failedStage: null,
    renderedVideoBlobKey: null,
    validation: [],
    pipelineLogs: [],
    usedLLM: false,
    templateLocked: true,
  };
  const all = loadAll();
  all.unshift(project);
  saveAll(all);
  void saveProjectToIDB(project);
  void syncProjectToDisk(project);
  setActiveProjectId(project.id);
  return project;
}

export function updateProject(id: string, patch: Partial<Project>): Project | null {
  const all = loadAll();
  const idx = all.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const updated: Project = { ...all[idx], ...patch, updatedAt: Date.now() };
  all[idx] = updated;
  saveAll(all);
  void saveProjectToIDB(updated);
  void syncProjectToDisk(updated);
  return updated;
}

export function deleteProject(id: string): void {
  const all = loadAll().filter((p) => p.id !== id);
  saveAll(all);
  deleteAudioBlob(id);
  void deleteProjectFromIDB(id);
  void deleteProjectFromDisk(id);
  if (getActiveProjectId() === id) {
    setActiveProjectId(null);
  }
}

export function duplicateProject(id: string): Project | null {
  const src = getProject(id);
  if (!src) return null;
  const copy: Project = {
    ...src,
    id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: `${src.title} (copy)`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const all = loadAll();
  all.unshift(copy);
  saveAll(all);
  void saveProjectToIDB(copy);
  void syncProjectToDisk(copy);
  return copy;
}

// Active project tracking
export function getActiveProjectId(): string | null {
  try {
    return localStorage.getItem(LS_ACTIVE);
  } catch {
    return null;
  }
}
export function setActiveProjectId(id: string | null) {
  try {
    if (id) localStorage.setItem(LS_ACTIVE, id);
    else localStorage.removeItem(LS_ACTIVE);
  } catch {}
  void saveActiveProjectIdToDisk(id);
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function getProjectAudioDuration(project: Project): number {
  if (project.audioDurationSec > 0) return project.audioDurationSec;
  // estimate from transcript: ~2.5 words/sec avg speech
  const words = project.transcriptText.split(/\s+/).filter(Boolean).length;
  return Math.max(10, Math.round(words / 2.5));
}
