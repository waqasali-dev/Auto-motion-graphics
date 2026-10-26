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
// IndexedDB for audio blobs (localStorage 5MB limit workaround)
// ──────────────────────────────────────────────────────────────────────────────

const DB_NAME = "frame60_audio";
const STORE = "blobs";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveAudioBlob(projectId: string, blob: Blob): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(blob, projectId);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch {
    // fallback: store as data URL in localStorage if IDB unavailable
  }
}

export async function saveRenderBlob(projectId: string, blob: Blob): Promise<void> {
  const db = await openDB();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, `render:${projectId}`);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  db.close();
}

export async function loadRenderBlob(projectId: string): Promise<Blob | null> {
  try {
    const db = await openDB();
    const blob = await new Promise<Blob | null>((res) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(`render:${projectId}`);
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
    const blob = await new Promise<Blob | null>((res) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(projectId);
      req.onsuccess = () => res((req.result as Blob) || null);
      req.onerror = () => res(null);
    });
    db.close();
    return blob;
  } catch {
    return null;
  }
}

export async function deleteAudioBlob(projectId: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((res) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(projectId);
      tx.objectStore(STORE).delete(`render:${projectId}`);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
    db.close();
  } catch {}
}

// ──────────────────────────────────────────────────────────────────────────────
// Project CRUD (localStorage)
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

function saveAll(projects: Project[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(projects));
  } catch (e) {
    console.warn("Failed to save projects (quota?)", e);
  }
}

export function getProjects(): Project[] {
  return loadAll().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getProject(id: string): Project | null {
  return loadAll().find((p) => p.id === id) ?? null;
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
    renderedVideoBlobKey: null,
    validation: [],
    pipelineLogs: [],
    usedLLM: false,
    templateLocked: true,
  };
  const all = loadAll();
  all.unshift(project);
  saveAll(all);
  return project;
}

export function updateProject(id: string, patch: Partial<Project>): Project | null {
  const all = loadAll();
  const idx = all.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  all[idx] = { ...all[idx], ...patch, updatedAt: Date.now() };
  saveAll(all);
  return all[idx];
}

export function deleteProject(id: string): void {
  const all = loadAll().filter((p) => p.id !== id);
  saveAll(all);
  deleteAudioBlob(id);
  // if active was this one, clear
  if (getActiveProjectId() === id) setActiveProjectId(null);
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
