// src/hooks/useTheme.ts
// Light/dark UI theme. Persists the user's choice and follows the OS until they pick.
// Only the app chrome changes — generated films keep the palette their planner chose.

import { useCallback, useEffect, useState } from "react";

export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const LS_KEY = "frame60_theme";

function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(LS_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {}
  return "system";
}

function apply(resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

/** Applies the stored theme before React paints, preventing a flash. */
export function initTheme() {
  const choice = readChoice();
  apply(choice === "system" ? systemTheme() : choice);
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(() => readChoice());
  const [resolved, setResolved] = useState<ResolvedTheme>(() => {
    const c = readChoice();
    return c === "system" ? systemTheme() : c;
  });

  useEffect(() => {
    const next = choice === "system" ? systemTheme() : choice;
    setResolved(next);
    apply(next);
    try {
      localStorage.setItem(LS_KEY, choice);
    } catch {}
  }, [choice]);

  // Track OS changes only while the user is on "system".
  useEffect(() => {
    if (choice !== "system" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const next = mq.matches ? "dark" : "light";
      setResolved(next);
      apply(next);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [choice]);

  const toggle = useCallback(() => {
    setChoice((current) => {
      const active = current === "system" ? systemTheme() : current;
      return active === "dark" ? "light" : "dark";
    });
  }, []);

  return { choice, resolved, setChoice, toggle, isDark: resolved === "dark" };
}
