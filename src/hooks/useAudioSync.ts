// src/hooks/useAudioSync.ts
// 60fps-accurate audio sync — the audio element IS the clock.
// Frame = floor(currentTime * 60). Play/pause/seek all go through <audio>.
// Falls back to rAF clock when no audioUrl is present (demo mode).

import { useCallback, useEffect, useRef, useState } from "react";

export function useAudioSync(audioUrl: string | null | undefined, totalFrames: number) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const rafRef = useRef<number | null>(null);

  // Create audio element when url changes
  useEffect(() => {
    if (!audioUrl) {
      setDurationSec(0);
      setCurrentFrame(0);
      return;
    }
    const audio = new Audio(audioUrl);
    audio.preload = "metadata";
    audioRef.current = audio;

    const onLoaded = () => setDurationSec(audio.duration || 0);
    const onTimeUpdate = () => {
      // driven by rAF loop below for 60fps, but keep as fallback
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);

    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.pause();
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audioRef.current = null;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [audioUrl]);

  // 60fps poll loop when audio is present — audio.currentTime is the truth
  useEffect(() => {
    if (!audioUrl || !audioRef.current) return;
    const loop = () => {
      if (audioRef.current && !audioRef.current.paused) {
        setCurrentFrame(Math.floor(audioRef.current.currentTime * 60));
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [audioUrl]);

  const play = useCallback(async () => {
    if (!audioRef.current) return;
    try {
      await audioRef.current.play();
    } catch {}
  }, []);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const toggle = useCallback(() => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) play();
    else pause();
  }, [play, pause]);

  const seekToFrame = useCallback((frame: number) => {
    const sec = frame / 60;
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, Math.min(sec, audioRef.current.duration || totalFrames / 60));
      setCurrentFrame(frame);
    } else {
      setCurrentFrame(frame);
    }
  }, [totalFrames]);

  const seekToSec = useCallback((sec: number) => {
    seekToFrame(Math.floor(sec * 60));
  }, [seekToFrame]);

  // Demo mode fallback: provide manual frame control when no audio
  const setFrameManual = useCallback((f: number) => {
    if (!audioUrl) setCurrentFrame(((f % totalFrames) + totalFrames) % totalFrames);
    else seekToFrame(f);
  }, [audioUrl, totalFrames, seekToFrame]);

  return {
    audioRef,
    audioElement: audioRef.current,
    isPlaying,
    currentFrame: audioUrl ? currentFrame : currentFrame, // same but explicit
    durationSec: audioUrl ? durationSec : totalFrames / 60,
    play,
    pause,
    toggle,
    seekToFrame: audioUrl ? seekToFrame : setFrameManual,
    seekToSec,
    hasAudio: !!audioUrl,
  };
}
