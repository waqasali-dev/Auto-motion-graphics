// FRAME/60 Studio — transcript-grounded art direction and model-authored Remotion.
// The reference reel is intentionally not imported here: every user shot is planned,
// art-directed, coded, compiled and smoked from this project's own transcript.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Project, PipelineLog } from "../services/projects";
import { createProject, getProject, getProjects, loadAudioBlob, saveAudioBlob, updateProject, setActiveProjectId } from "../services/projects";
import { normalizeTranscriptJson, alignTranscriptWords } from "../services/transcript";
import { textToRawTranscript } from "../services/pipeline";
import { transcribeAudio } from "../services/openai";
import { getEnvStatus, hasValidKey } from "../services/env";
import { runCreativePipeline, regenerateGeneratedShot } from "../services/creativePipeline";
import { GeneratedFilmPlayer } from "./GeneratedFilmPlayer";
import { PipelineProgress, type StageProgress } from "./PipelineProgress";
import type { GeneratedFilm } from "../sdk/contract.generated";
import { AlertTriangle, FileText, Music, Sparkles, Upload, Wand2, Settings2, Clapperboard } from "lucide-react";

const FPS = 60;

export function Studio({
  activeProjectId,
  onProjectChange,
  onProjectIdChange,
  onOpenSettings,
}: {
  activeProjectId: string | null;
  onProjectChange?: () => void;
  onProjectIdChange?: (id: string) => void;
  onOpenSettings?: () => void;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [projectTitle, setProjectTitle] = useState("Untitled motion film");
  const [transcriptText, setTranscriptText] = useState("");
  const [rawTranscript, setRawTranscript] = useState<Project["rawTranscript"]>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [creativeBrief, setCreativeBrief] = useState("");
  const [pipelineLogs, setPipelineLogs] = useState<PipelineLog[]>([]);
  const [stageProgress, setStageProgress] = useState<StageProgress | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [film, setFilm] = useState<GeneratedFilm | null>(null);
  const [processing, setProcessing] = useState(false);
  const [aligning, setAligning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const transcriptInput = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  const env = getEnvStatus();
  const apiReady = hasValidKey();

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (!activeProjectId) {
        setProject(null);
        setProjectTitle("Untitled motion film");
        setTranscriptText("");
        setRawTranscript(null);
        setFilm(null);
        setAudioFile(null);
        setAudioDuration(0);
        setPipelineLogs([]);
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
        setAudioUrl(null);
        return;
      }
      const p = getProject(activeProjectId) ?? getProjects().find((x) => x.id === activeProjectId) ?? null;
      if (!p || !alive) return;
      setProject(p);
      setProjectTitle(p.title);
      setTranscriptText(p.transcriptText ?? "");
      setRawTranscript(p.rawTranscript ?? null);
      setAudioDuration(p.audioDurationSec ?? 0);
      setPipelineLogs(p.pipelineLogs ?? []);
      setFilm(p.generatedFilm ?? null);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
      if (p.audioUrl?.startsWith("blob:")) {
        setAudioUrl(p.audioUrl);
      } else if (p.audioFileName) {
        const blob = await loadAudioBlob(p.id);
        if (blob && alive) {
          const url = URL.createObjectURL(blob);
          objectUrlRef.current = url;
          setAudioUrl(url);
          setAudioFile(new File([blob], p.audioFileName, { type: blob.type || "audio/mpeg" }));
        } else if (alive) setAudioUrl(null);
      } else setAudioUrl(null);
    };
    void load();
    return () => {
      alive = false;
    };
  }, [activeProjectId]);

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  const ensureProject = useCallback((patch?: Partial<Project>) => {
    let current = project;
    if (!current) {
      current = createProject({
        title: projectTitle.trim() || `Film ${new Date().toLocaleDateString()}`,
        transcriptText,
        audioFileName: audioFile?.name,
        audioDurationSec: audioDuration || 0,
        rawTranscript,
      });
      setProject(current);
      setActiveProjectId(current.id);
      onProjectIdChange?.(current.id);
    }
    if (patch) {
      const next = updateProject(current.id, patch);
      if (next) {
        current = next;
        setProject(next);
      }
    }
    return current;
  }, [project, projectTitle, transcriptText, audioFile, audioDuration, rawTranscript, onProjectIdChange]);

  const handleAudioUpload = useCallback(async (file: File) => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setAudioFile(file);
    setAudioUrl(url);
    const probe = new Audio(url);
    probe.preload = "metadata";
    await new Promise<void>((resolve) => {
      probe.onloadedmetadata = () => resolve();
      probe.onerror = () => resolve();
      window.setTimeout(resolve, 2500);
    });
    const duration = Number.isFinite(probe.duration) ? probe.duration : 0;
    setAudioDuration(duration);
    const p = ensureProject({ audioFileName: file.name, audioDurationSec: duration, audioUrl: undefined });
    await saveAudioBlob(p.id, file);
    onProjectChange?.();
  }, [ensureProject, onProjectChange]);

  const handleTranscriptUpload = useCallback(async (file: File) => {
    const text = await file.text();
    if (file.name.toLowerCase().endsWith(".json")) {
      try {
        const json = JSON.parse(text);
        const normalized = normalizeTranscriptJson(json, audioDuration || 30);
        setRawTranscript(normalized);
        const plain = normalized.sentences.map((s) => s.text).join(" ");
        setTranscriptText(plain);
        ensureProject({ transcriptText: plain, rawTranscript: normalized });
        onProjectChange?.();
        return;
      } catch (e) {
        setError(`Transcript JSON could not be read: ${(e as Error).message}`);
        return;
      }
    }
    const plain = file.name.toLowerCase().endsWith(".srt") || file.name.toLowerCase().endsWith(".vtt")
      ? text.replace(/^\s*\d+\s*\r?\n|\d{2}:\d{2}:\d{2}[,.]\d+\s*-->[^\r\n]*\r?\n/gm, "").replace(/^WEBVTT\s*/i, "").trim()
      : text;
    setTranscriptText(plain.trim());
    setRawTranscript(null);
    ensureProject({ transcriptText: plain.trim(), rawTranscript: null });
    onProjectChange?.();
  }, [audioDuration, ensureProject, onProjectChange]);

  const handleGenerate = useCallback(async () => {
    setError(null);
    if (!apiReady) {
      setError("AI-authored Remotion scenes require an OpenAI-compatible API key. Open API Settings; there is intentionally no prebuilt-template fallback for user films.");
      onOpenSettings?.();
      return;
    }
    if (!audioFile && !rawTranscript && transcriptText.trim().length < 4) {
      setError("Upload audio and a transcript. If you have only audio, the configured Whisper model can transcribe and word-align it.");
      return;
    }
    setProcessing(true);
    setPipelineLogs([]);
    setStageProgress(null);
    setStartedAt(Date.now());
    const log = (entry: PipelineLog) => setPipelineLogs((old) => [...old, entry]);
    try {
      let raw = rawTranscript ? normalizeTranscriptJson(rawTranscript, audioDuration || 30) : null;
      let finalText = transcriptText.trim();
      let alignment: GeneratedFilm["alignment"] = "estimated";
      let confidence = 0.5;
      let duration = audioDuration;

      if (audioFile && (!raw || !raw.words.length)) {
        setAligning(true);
        try {
          if (!hasValidKey()) throw new Error("Whisper word alignment needs the configured API key.");
          log({ stage: "1_audio-align", message: finalText ? "Transcribing audio to align each provided transcript word to its spoken timestamp…" : "Transcribing audio and extracting word-level timestamps…", status: "running", timestamp: Date.now() });
          const result = await transcribeAudio(audioFile, (message) => log({ stage: "1_audio-align", message, status: "running", timestamp: Date.now() }));
          if (!duration) duration = audioFile ? Math.max(1, audioDuration) : 30;
          const targetText = finalText || result.text;
          if (!finalText) {
            finalText = result.text;
            setTranscriptText(result.text);
          }
          if (!result.words?.length) throw new Error("The transcription model returned no word timestamps. Upload word-timed JSON or use a model/route that supports Whisper word timestamps.");
          const aligned = alignTranscriptWords(targetText, result.words, duration);
          raw = aligned.raw;
          confidence = aligned.confidence;
          alignment = "whisper-aligned";
          setRawTranscript(raw);
          log({ stage: "1_audio-align", message: `Aligned ${raw.words.length} transcript words to audio. Match confidence ${Math.round(confidence * 100)}%.`, status: "success", timestamp: Date.now() });
        } catch (alignErr) {
          if (finalText) {
            log({ stage: "1_audio-align", message: `Whisper not available on gateway (${(alignErr as Error).message}). Using transcript text aligned to audio duration.`, status: "running", timestamp: Date.now() });
            duration = duration || Math.max(8, audioDuration || finalText.split(/\s+/).filter(Boolean).length / 2.45);
            raw = textToRawTranscript(finalText, duration, undefined);
            alignment = "estimated";
            confidence = 0.75;
            setRawTranscript(raw);
          } else {
            throw alignErr;
          }
        } finally {
          setAligning(false);
        }
      } else if (raw?.words.length) {
        alignment = "word-json";
        confidence = raw.words.reduce((sum, w) => sum + w.confidence, 0) / raw.words.length;
        duration = raw.audio.durationSec || duration || 30;
        finalText = raw.sentences.map((s) => s.text).join(" ") || finalText;
      } else if (finalText) {
        duration = duration || Math.max(8, finalText.split(/\s+/).filter(Boolean).length / 2.45);
        raw = textToRawTranscript(finalText, duration, undefined);
        alignment = "estimated";
        confidence = 0.3;
      }

      if (!raw || !raw.sentences.length || !raw.words.length) throw new Error("No usable transcript words were produced.");
      if (audioFile && confidence < 0.55) {
        log({ stage: "1_audio-align", message: "Alignment confidence is low: review the transcript before generating; timing still follows Whisper audio cues.", status: "error", timestamp: Date.now() });
      }

      const p = ensureProject({
        title: projectTitle.trim() || project?.title || "Untitled motion film",
        transcriptText: finalText,
        audioDurationSec: duration,
        audioFileName: audioFile?.name ?? project?.audioFileName,
        audioUrl: undefined,
        rawTranscript: raw,
        status: "processing",
        generatedFilm: null,
      });
      if (audioFile) await saveAudioBlob(p.id, audioFile);
      setAudioDuration(duration);
      setTranscriptText(finalText);
      setRawTranscript(raw);

      const resultFilm = await runCreativePipeline({
        title: projectTitle.trim() || p.title,
        sourceTranscript: finalText,
        creativeBrief: creativeBrief.trim() || undefined,
        rawTranscript: raw,
        audioDurationSec: duration,
        sourceAudioName: audioFile?.name ?? p.audioFileName,
        alignment,
        alignmentConfidence: confidence,
        onLog: log,
        onStage: (stage, completed, total, message) => setStageProgress({ stage, completed, total, message }),
      });

      setFilm(resultFilm);
      const updated = updateProject(p.id, {
        title: projectTitle.trim() || p.title,
        transcriptText: finalText,
        audioDurationSec: duration,
        rawTranscript: raw,
        generatedFilm: resultFilm,
        beats: [],
        shots: [],
        frameLocked: [],
        varietyReport: null,
        status: "ready",
        usedLLM: true,
        templateLocked: true,
        pipelineLogs: [...pipelineLogs, { stage: "5_validator", message: "All model-authored scenes compiled and smoke rendered.", status: "success", timestamp: Date.now() }],
      });
      if (updated) setProject(updated);
      onProjectChange?.();
    } catch (e) {
      const message = (e as Error).message || "Unknown generation error";
      setError(message);
      setPipelineLogs((old) => [...old, { stage: "error", message, status: "error", timestamp: Date.now() }]);
      if (project) updateProject(project.id, { status: "error", pipelineLogs: [...pipelineLogs, { stage: "error", message, status: "error", timestamp: Date.now() }] });
    } finally {
      setAligning(false);
      setProcessing(false);
    }
  }, [apiReady, audioFile, rawTranscript, transcriptText, audioDuration, hasValidKey, onOpenSettings, onProjectChange, pipelineLogs, ensureProject, projectTitle, project, creativeBrief]);

  const regenerateShot = useCallback(async (shotId: string, validationError?: string) => {
    if (!film) return;
    setProcessing(true);
    const log = (entry: PipelineLog) => setPipelineLogs((old) => [...old, entry]);
    try {
      const replacement = await regenerateGeneratedShot(film, shotId, validationError, log);
      const next: GeneratedFilm = { ...film, shots: film.shots.map((s) => s.shotId === shotId ? replacement : s), createdAt: Date.now() };
      setFilm(next);
      if (project) updateProject(project.id, { generatedFilm: next, renderedVideoBlobKey: null });
      onProjectChange?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProcessing(false);
    }
  }, [film, project, onProjectChange]);

  const handleJsonPaste = (value: string) => {
    try {
      const parsed = JSON.parse(value);
      const normalized = normalizeTranscriptJson(parsed, audioDuration || 30);
      setRawTranscript(normalized);
      const text = normalized.sentences.map((s) => s.text).join(" ");
      if (text) setTranscriptText(text);
      ensureProject({ rawTranscript: normalized, transcriptText: text || transcriptText });
      setError(null);
    } catch (e) {
      setError(`Transcript JSON is invalid: ${(e as Error).message}`);
    }
  };

  const wordCount = transcriptText.trim() ? transcriptText.trim().split(/\s+/).filter(Boolean).length : 0;
  const sentenceCount = transcriptText.trim() ? transcriptText.split(/(?<=[.!?])\s+/).filter(Boolean).length : 0;
  const estimatedSeconds = audioDuration || (wordCount ? Math.max(8, wordCount / 2.45) : 0);
  const canGenerate = apiReady && !processing && !aligning && (!!audioFile || !!rawTranscript || transcriptText.trim().length >= 4);
  const hasInput = !!audioFile || !!rawTranscript || transcriptText.trim().length > 0;
  // Shot count is derived from runtime, never fixed — so long scripts simply make more shots.
  const estimatedShots = estimatedSeconds ? Math.max(1, Math.round(estimatedSeconds / 11)) : 0;
  const isLongForm = estimatedSeconds > 200;

  return (
    <div className="min-h-screen bg-[color:var(--color-surface-2)]">
      <header className="sticky top-14 z-30 border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)]/90 backdrop-blur">
        <div className="max-w-[1600px] mx-auto px-5 md:px-8 py-3 flex flex-wrap items-center gap-3">
          <Clapperboard className="w-5 h-5 text-blue-500 flex-shrink-0" />
          <div className="min-w-0">
            <input
              value={projectTitle}
              onChange={(e) => { setProjectTitle(e.target.value); if (project) updateProject(project.id, { title: e.target.value }); }}
              className="font-semibold bg-transparent outline-none truncate max-w-[420px] text-[color:var(--color-text)] focus:underline underline-offset-4"
              aria-label="Film title"
            />
            <div className="font-mono text-[10px] uppercase tracking-widest text-[color:var(--color-text-faint)]">
              AI-authored Remotion · word-synced · no preset scenes
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className={`px-3 py-1.5 rounded-full border font-mono text-[10px] ${apiReady ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>
              {apiReady ? `${env.model} · connected` : "Model not configured"}
            </div>
            <button onClick={onOpenSettings} className="p-2 rounded-lg bg-[color:var(--color-surface)] border border-[color:var(--color-border)] hover:bg-[color:var(--color-surface-3)] text-[color:var(--color-text-soft)]" aria-label="AI configuration">
              <Settings2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-5 md:px-8 py-6">
        {/* ── INPUTS: always visible on the page, never hidden behind a panel ── */}
        <section className={film ? "mb-6" : "mb-6"}>
          <div className="flex items-end justify-between gap-4 mb-3 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold text-[color:var(--color-text)]">Start from your script</h2>
              <p className="text-sm text-[color:var(--color-text-soft)]">
                Transcript is required. Audio is optional — add it and every word is locked to its real spoken frame.
              </p>
            </div>
            {estimatedSeconds > 0 && (
              <div className="text-right">
                <div className="font-mono text-[11px] text-[color:var(--color-text-faint)]">
                  {estimatedSeconds >= 60 ? `${Math.floor(estimatedSeconds / 60)}m ${Math.round(estimatedSeconds % 60)}s` : `${estimatedSeconds.toFixed(1)}s`}
                  {" · "}{Math.ceil(estimatedSeconds * FPS).toLocaleString()} frames · 1920×1080 · 60fps
                </div>
                <div className="font-mono text-[11px] text-[color:var(--color-text-faint)] mt-0.5">
                  ≈ {estimatedShots} shot{estimatedShots === 1 ? "" : "s"} — the planner decides the real count from your content
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Transcript — primary input */}
            <div className="lg:col-span-7 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4">
              <div className="flex items-center gap-2 mb-3">
                <FileText className="w-4 h-4 text-blue-500" />
                <h3 className="font-semibold text-sm text-[color:var(--color-text)]">Transcript</h3>
                <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-300 font-mono text-[9px] uppercase tracking-wide">required</span>
                <button onClick={() => transcriptInput.current?.click()} className="ml-auto px-3 py-1.5 rounded-lg bg-[color:var(--color-text)] text-[color:var(--color-surface)] text-xs font-medium hover:opacity-90">
                  Upload TXT · SRT · JSON
                </button>
                <input ref={transcriptInput} type="file" hidden accept=".txt,.srt,.vtt,.json" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleTranscriptUpload(f); e.target.value = ""; }} />
              </div>
              <textarea
                value={transcriptText}
                onChange={(e) => { setTranscriptText(e.target.value); setRawTranscript(null); }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void handleTranscriptUpload(f); }}
                className="w-full h-44 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-2)] p-3 text-sm leading-relaxed text-[color:var(--color-text)] placeholder:text-[color:var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                placeholder="Paste or drop the words spoken in your video. Each sentence becomes a word-aligned visual beat."
              />
              <div className="mt-2 flex justify-between font-mono text-[10px] text-[color:var(--color-text-faint)]">
                <span>{wordCount} words · {sentenceCount} sentences</span>
                <span>{rawTranscript?.words.length ? `${rawTranscript.words.length} timed cues` : "timing resolved on generate"}</span>
              </div>
              <details className="mt-3 group">
                <summary className="text-xs text-[color:var(--color-text-faint)] cursor-pointer hover:text-[color:var(--color-text-soft)] select-none">
                  Have word-timed JSON? Paste it for exact sync
                </summary>
                <textarea
                  onBlur={(e) => { if (e.target.value.trim()) handleJsonPaste(e.target.value); }}
                  className="mt-2 w-full h-24 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface-2)] p-2 font-mono text-xs text-[color:var(--color-text)]"
                  placeholder='{"audio":{"durationSec":12},"words":[{"text":"hello","start":0,"end":0.4}]}'
                />
              </details>
            </div>

            {/* Audio — optional */}
            <div className="lg:col-span-5 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4 flex flex-col">
              <div className="flex items-center gap-2 mb-3">
                <Music className="w-4 h-4 text-blue-500" />
                <h3 className="font-semibold text-sm text-[color:var(--color-text)]">Audio</h3>
                <span className="px-1.5 py-0.5 rounded bg-[color:var(--color-surface-3)] text-[color:var(--color-text-faint)] font-mono text-[9px] uppercase tracking-wide">optional</span>
                {audioFile && (
                  <button
                    onClick={() => { setAudioFile(null); setAudioUrl(null); setAudioDuration(0); setRawTranscript(null); }}
                    className="ml-auto text-[11px] text-[color:var(--color-text-faint)] hover:text-red-500"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.type.startsWith("audio/")) void handleAudioUpload(f); }}
                onClick={() => audioInput.current?.click()}
                className="flex-1 rounded-xl border-2 border-dashed border-[color:var(--color-border)] hover:border-blue-500/60 hover:bg-blue-500/5 p-5 text-center cursor-pointer flex flex-col items-center justify-center min-h-[128px] transition-colors"
              >
                <Upload className="w-6 h-6 text-[color:var(--color-text-faint)] mb-2" />
                <div className="text-sm font-semibold text-[color:var(--color-text)]">{audioFile?.name || project?.audioFileName || "Drop audio or browse"}</div>
                <div className="text-xs text-[color:var(--color-text-soft)] mt-1">
                  {audioFile ? `${(audioFile.size / 1048576).toFixed(1)} MB` : "MP3 · WAV · M4A"}
                </div>
                {audioDuration > 0 && <div className="font-mono text-xs text-blue-500 mt-2">{audioDuration.toFixed(2)}s · {Math.ceil(audioDuration * FPS).toLocaleString()} frames</div>}
              </div>
              <input ref={audioInput} type="file" hidden accept="audio/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleAudioUpload(f); e.target.value = ""; }} />
              {audioUrl && <audio controls src={audioUrl} className="w-full mt-3 h-9" preload="metadata" />}
              <p className="text-[11px] text-[color:var(--color-text-faint)] mt-2 leading-relaxed">
                {audioFile
                  ? "Whisper aligns your transcript to this audio, then the film is cut to those exact word frames."
                  : "Without audio, word timing is estimated from reading pace and the film plays on its own clock."}
              </p>
            </div>
          </div>

          {/* Creative direction + action */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mt-4">
            <div className="lg:col-span-7 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-blue-500" />
                <h3 className="font-semibold text-sm text-[color:var(--color-text)]">Creative direction</h3>
                <span className="ml-auto font-mono text-[9px] uppercase tracking-wide text-[color:var(--color-text-faint)]">optional</span>
              </div>
              <textarea
                value={creativeBrief}
                onChange={(e) => setCreativeBrief(e.target.value)}
                className="w-full h-[88px] rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-2)] p-3 text-sm text-[color:var(--color-text)] placeholder:text-[color:var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                placeholder="e.g. 'Close-up physical metaphors, move from anxious to optimistic, avoid charts unless a number is spoken.'"
              />
            </div>
            <div className="lg:col-span-5 flex flex-col gap-2">
              <button
                disabled={!canGenerate}
                onClick={() => void handleGenerate()}
                className="w-full flex-1 min-h-[88px] rounded-2xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 transition-colors"
              >
                {processing || aligning ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Wand2 className="w-4 h-4" />}
                {aligning ? "Aligning to speech…" : processing ? "Generating…" : film ? "Regenerate film" : "Generate film"}
              </button>
              {!apiReady && (
                <button onClick={onOpenSettings} className="text-xs text-amber-600 dark:text-amber-300 underline underline-offset-2">
                  Add a model API key to enable generation
                </button>
              )}
              {apiReady && !hasInput && (
                <p className="text-[11px] text-center text-[color:var(--color-text-faint)]">Add a transcript to begin.</p>
              )}
              {apiReady && hasInput && isLongForm && !processing && (
                <p className="text-[11px] text-center text-[color:var(--color-text-faint)] leading-relaxed">
                  Long script: planned in parts, then ~{estimatedShots} scenes are written in parallel. This takes a few minutes.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* ── PROGRESS: minimal headings, expandable model working ── */}
        {(pipelineLogs.length > 0 || processing) && (
          <section className="mb-6">
            <PipelineProgress logs={pipelineLogs} stageProgress={stageProgress} running={processing || aligning} startedAt={startedAt} />
          </section>
        )}

        {error && (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 p-3 flex gap-2 text-sm text-red-700 dark:text-red-300">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* ── OUTPUT ── */}
        <section>
          {film ? (
            <GeneratedFilmPlayer
              projectId={project?.id ?? film.id}
              film={film}
              audioSrc={audioUrl ?? undefined}
              onProjectUpdate={onProjectChange}
              onRegenerateShot={(id, trace) => void regenerateShot(id, trace)}
            />
          ) : (
            <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-8 md:p-12">
              <div className="font-mono text-xs uppercase tracking-[0.28em] text-blue-500">No templates are inserted here</div>
              <h2 className="mt-4 text-3xl md:text-5xl font-semibold tracking-tight text-[color:var(--color-text)]">
                The model plans it.<br />The model draws it.
              </h2>
              <p className="mt-5 max-w-2xl text-[color:var(--color-text-soft)] leading-relaxed">
                Your transcript is split into word-aligned ideas. An art director writes a shot-specific visual prompt.
                A Remotion worker then authors original TSX for that one shot, which is compiled and smoke-rendered before preview.
              </p>
              <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                {[
                  ["01 / STORY", "What each spoken beat should show"],
                  ["02 / ART DIRECTION", "Precise composition and word choreography"],
                  ["03 / REMOTION", "New TSX code, compiled and frame-tested"],
                ].map(([k, v]) => (
                  <div key={k} className="border-t border-[color:var(--color-border)] pt-3">
                    <span className="font-mono text-blue-500">{k}</span>
                    <div className="text-[color:var(--color-text-soft)] mt-1">{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
