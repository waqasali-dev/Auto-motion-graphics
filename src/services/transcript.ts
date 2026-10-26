// Normalizes user transcripts and aligns user-written words to Whisper timings.
// The audio timestamps remain the authority; text cleanup never moves them.

import type { RawTranscriptJSON } from "../sdk/contract.pipeline";
import { textToRawTranscript } from "./pipeline";

export interface WhisperWord {
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

const token = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9']/g, "");

function splitTokens(text: string): string[] {
  return text.match(/[^\s]+/g) ?? [];
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.startsWith(b) || b.startsWith(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  if (a.length > 40 || b.length > 40) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + Number(a[i - 1] !== b[j - 1]));
    prev = row;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

/** Greedy monotonic local alignment; unmatched words interpolate between anchors. */
export function alignTranscriptWords(text: string, asrWords: WhisperWord[], durationSec: number): { raw: RawTranscriptJSON; confidence: number } {
  const source = splitTokens(text);
  if (!source.length || !asrWords.length) throw new Error("Word-level audio transcription is required to align a transcript to audio.");
  const normalizedAsr = asrWords.map((w) => token(w.text));
  const anchors: Array<{ asrIndex: number; score: number } | null> = new Array(source.length).fill(null);
  let cursor = 0;

  for (let i = 0; i < source.length; i++) {
    const target = token(source[i]);
    let bestIndex = -1;
    let bestScore = 0;
    const end = Math.min(asrWords.length, cursor + 8);
    for (let j = cursor; j < end; j++) {
      const score = similarity(target, normalizedAsr[j]);
      const skipPenalty = (j - cursor) * 0.035;
      if (score - skipPenalty > bestScore) {
        bestScore = score - skipPenalty;
        bestIndex = j;
      }
    }
    if (bestIndex >= 0 && bestScore >= 0.45) {
      anchors[i] = { asrIndex: bestIndex, score: bestScore };
      cursor = bestIndex + 1;
    }
  }

  const times: Array<{ start: number; end: number; confidence: number }> = new Array(source.length);
  const known = anchors.map((a, i) => (a ? i : -1)).filter((i) => i >= 0);
  for (const i of known) {
    const a = anchors[i]!;
    const w = asrWords[a.asrIndex];
    times[i] = { start: w.start, end: w.end, confidence: Math.min(w.confidence ?? 0.92, a.score) };
  }

  for (let i = 0; i < source.length; i++) {
    if (times[i]) continue;
    let before = i - 1;
    while (before >= 0 && !times[before]) before--;
    let after = i + 1;
    while (after < source.length && !times[after]) after++;
    const left = before >= 0 ? times[before].end : 0;
    const right = after < source.length ? times[after].start : durationSec;
    const count = after - before;
    const start = left + ((i - before - 1) / Math.max(1, count)) * (right - left);
    const end = left + ((i - before) / Math.max(1, count)) * (right - left);
    times[i] = { start, end: Math.max(start + 0.02, end), confidence: 0.35 };
  }

  const sentenceTexts: string[] = [];
  let current = "";
  const sentenceMap: Array<{ startWord: number; endWord: number; text: string }> = [];
  let startWord = 0;
  for (let i = 0; i < source.length; i++) {
    current += (current ? " " : "") + source[i];
    const terminal = /[.!?]$/.test(source[i]) || i === source.length - 1;
    if (terminal) {
      sentenceMap.push({ startWord, endWord: i, text: current });
      sentenceTexts.push(current);
      current = "";
      startWord = i + 1;
    }
  }

  const words: RawTranscriptJSON["words"] = source.map((word, i) => {
    const t = times[i];
    const next = times[i + 1];
    const spokenEnd = Math.min(t.end, Math.max(t.start, t.start + (t.end - t.start) * 0.88));
    const end = next ? Math.max(t.end, next.start) : Math.min(durationSec, t.end + 0.12);
    return { text: word, start: t.start, spokenEnd, end, confidence: t.confidence };
  });

  const sentences: RawTranscriptJSON["sentences"] = sentenceMap.map((s, i) => ({
    index: i,
    start: words[s.startWord]?.start ?? 0,
    spokenEnd: words[s.endWord]?.spokenEnd ?? 0,
    end: words[s.endWord]?.end ?? durationSec,
    text: s.text,
    wordStart: s.startWord,
    wordEnd: s.endWord,
  }));

  const matched = known.length ? known.reduce((sum, i) => sum + (anchors[i]?.score ?? 0), 0) / known.length : 0;
  const coverage = known.length / Math.max(1, source.length);
  const confidence = Math.max(0, Math.min(1, matched * 0.7 + coverage * 0.3));
  return { raw: { audio: { durationSec }, words, sentences }, confidence };
}

export function normalizeTranscriptJson(input: unknown, fallbackDurationSec: number): RawTranscriptJSON {
  const obj = input as Record<string, any>;
  const duration = Number(obj.audio?.durationSec ?? obj.durationSec ?? obj.duration ?? fallbackDurationSec) || fallbackDurationSec;
  const rawWords: any[] = Array.isArray(obj.words) ? obj.words : Array.isArray(obj.segments) ? obj.segments.flatMap((s: any) => s.words ?? []) : [];
  const words: RawTranscriptJSON["words"] = rawWords.map((w) => {
    const start = Number(w.start ?? w.startTime ?? 0);
    const end = Number(w.end ?? w.endTime ?? start + 0.25);
    const spokenEnd = Number(w.spokenEnd ?? w.spoken_end ?? end);
    return {
      text: String(w.text ?? w.word ?? "").trim(),
      start,
      spokenEnd,
      end: Math.max(end, spokenEnd),
      confidence: Number(w.confidence ?? w.probability ?? 0.9),
    };
  }).filter((w) => w.text);
  let sentences: RawTranscriptJSON["sentences"];
  if (Array.isArray(obj.sentences) && obj.sentences.length) {
    sentences = obj.sentences.map((s: any, i: number) => ({
      index: Number(s.index ?? i),
      start: Number(s.start ?? 0),
      spokenEnd: Number(s.spokenEnd ?? s.spoken_end ?? s.end ?? 0),
      end: Number(s.end ?? s.spokenEnd ?? 0),
      text: String(s.text ?? ""),
      wordStart: Number(s.wordStart ?? s.word_start ?? 0),
      wordEnd: Number(s.wordEnd ?? s.word_end ?? Math.max(0, words.length - 1)),
    }));
  } else if (words.length) {
    sentences = [];
    let start = 0;
    let current = "";
    for (let i = 0; i < words.length; i++) {
      current += (current ? " " : "") + words[i].text;
      if (/[.!?]$/.test(words[i].text) || i === words.length - 1) {
        sentences.push({ index: sentences.length, start: words[start].start, spokenEnd: words[i].spokenEnd, end: words[i].end, text: current, wordStart: start, wordEnd: i });
        start = i + 1;
        current = "";
      }
    }
  } else {
    const text = String(obj.text ?? "");
    return textToRawTranscript(text, duration, obj.audio?.url);
  }
  return { audio: { durationSec: duration, url: obj.audio?.url }, words, sentences };
}