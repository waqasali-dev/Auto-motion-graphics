import { useEffect, useState } from "react";
import { ShotPlayer, SHOTS, VARIETY_REPORT, posterFrame } from "./components/ShotPlayer";
import { VarietyAudit } from "./components/VarietyAudit";
import { Pipeline } from "./components/Pipeline";
import { Schema } from "./components/Schema";
import { DirectoryTree } from "./components/DirectoryTree";
import { AmbientCanvas } from "./sdk/AmbientCanvas";
import { ARCHETYPE_REGISTRY, ALL_ARCHETYPES } from "./sdk/registry";
import type { ArchetypeName, SceneContent } from "./sdk/contract";
import { tokens, useFrameClock } from "./sdk/primitives";
import { ShotStill } from "./mg/stage";
import { ARCHETYPE_META, FAMILY_INFO } from "./variety/taxonomy";
import { Studio } from "./components/Studio";
import { ProjectsDashboard } from "./components/ProjectsDashboard";
import { SettingsDialog } from "./components/SettingsDialog";
import { getProjects, getActiveProjectId, setActiveProjectId, createProject } from "./services/projects";
import { getEnvStatus } from "./services/env";
import { useTheme } from "./hooks/useTheme";
import { Moon, Sun } from "lucide-react";

// ── Hero helpers ──
const HERO_PICKS = [SHOTS[1], SHOTS[3], SHOTS[4], SHOTS[10]];

function HeroCounter() {
  const { frame } = useFrameClock(true);
  return <div className="tabular-nums" style={{ color: tokens.electricBlue }}>f {frame.toString().padStart(6, "0")}</div>;
}

function Hero({ onGoStudio }: { onGoStudio: () => void }) {
  return (
    <section className="relative overflow-hidden bg-[color:var(--color-dark)] text-[color:var(--color-primary-text-dark)]">
      <AmbientCanvas mode="dark" variant="rings" />
      <div className="relative z-10 max-w-[1400px] mx-auto px-6 md:px-12 pt-24 md:pt-32 pb-20 md:pb-36">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.3em] mb-16">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full blink-dot" style={{ background: tokens.coralRed }} />
            <span>frame/60 · build {new Date().getFullYear()}.0</span>
          </div>
          <div className="hidden md:flex items-center gap-6" style={{ color: tokens.inkSoft }}>
            <button onClick={onGoStudio} className="link-underline cursor-pointer">studio</button>
            <a href="#player" className="link-underline">demo</a>
            <a href="#pipeline" className="link-underline">pipeline</a>
            <a href="#sdk" className="link-underline">sdk</a>
          </div>
          <HeroCounter />
        </div>

        <div className="max-w-5xl">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] mb-6" style={{ color: tokens.electricBlue }}>
            · an ai transcript-to-motion-graphics engine
          </div>
          <h1 className="text-[44px] leading-[0.98] md:text-[96px] md:leading-[0.94] font-semibold tracking-tight">
            Deterministic video
            <br />
            from <span className="font-serif-italic" style={{ color: tokens.electricBlue }}>speech</span> —
            <br />
            one frame at a <span className="font-serif-italic" style={{ color: tokens.coralRed }}>time</span>.
          </h1>

          <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8 max-w-5xl">
            <Stat k="fps" v="60" label="frame-locked, never 59.94" />
            <Stat k="resolution" v="1920 × 1080" label="or 1080 × 1920 vertical" />
            <Stat k="timeline gaps" v="0" label="Shot[N].start = Shot[N−1].end" />
            <Stat k="visual grammars" v="14" label="planned across five families" />
          </div>

          <div className="mt-12 flex flex-wrap items-center gap-3">
            <button onClick={onGoStudio} className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[color:var(--color-electric)] text-white text-sm font-semibold hover:bg-[#0055d9] transition-colors">
              Open Studio — Upload Audio <span aria-hidden>→</span>
            </button>
            <a href="#player" className="inline-flex items-center gap-2 px-5 py-3 rounded-full border text-sm font-medium hover:bg-white/5 transition-colors" style={{ borderColor: tokens.ruleDark }}>
              Watch 67s Demo
            </a>
          </div>
        </div>

        <div className="mt-16 md:mt-20">
          <div className="flex items-baseline justify-between mb-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.3em]" style={{ color: tokens.inkSoft }}>
              · one transcript / planned across five families
            </div>
            <button onClick={onGoStudio} className="font-mono text-[10px] uppercase tracking-[0.26em] link-underline" style={{ color: tokens.electricBlue }}>
              open studio →
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {HERO_PICKS.map((s) => (
              <button key={s.shotId} onClick={onGoStudio} className="group block text-left rounded-xl overflow-hidden border transition-transform duration-300 hover:-translate-y-1" style={{ borderColor: tokens.ruleDark, background: "#060A12" }}>
                <div className="relative pointer-events-none overflow-hidden">
                  <ShotStill shot={s} frame={posterFrame(s)} registry={ARCHETYPE_REGISTRY} />
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ boxShadow: "inset 0 0 0 1.5px rgba(0,102,255,0.85)" }} />
                </div>
                <div className="flex items-center justify-between px-3 py-2 gap-2">
                  <span className="font-mono text-[9px] uppercase tracking-widest truncate" style={{ color: "rgba(229,234,242,0.85)" }}>{s.archetype}</span>
                  <span className="font-mono text-[9px] uppercase tracking-widest flex-shrink-0" style={{ color: tokens.inkSoft }}>{s.shotId}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-20 md:mt-28 pt-6 border-t flex flex-wrap items-center gap-x-10 gap-y-3 font-mono text-[10px] uppercase tracking-[0.3em]" style={{ borderColor: tokens.ruleDark, color: tokens.inkSoft }}>
          <span>Node.js · TypeScript</span>
          <span>Remotion · React</span>
          <span>ESBuild · AST</span>
          <span>LLM Structured Outputs</span>
          <span className="ml-auto" style={{ color: tokens.electricBlue }}>Motion Graphics 1920×1080</span>
        </div>
      </div>
    </section>
  );
}

function Stat({ k, v, label }: { k: string; v: string; label: string }) {
  return (
    <div className="border-t pt-4" style={{ borderColor: tokens.ruleDark }}>
      <div className="font-mono text-[10px] uppercase tracking-[0.3em] mb-1.5" style={{ color: tokens.inkSoft }}>{k}</div>
      <div className="text-3xl md:text-4xl font-semibold tabular-nums mb-1">{v}</div>
      <div className="text-xs" style={{ color: tokens.inkSoft }}>{label}</div>
    </div>
  );
}

function Section({ id, eyebrow, title, intro, children, dark = false }: { id?: string; eyebrow: string; title: React.ReactNode; intro?: React.ReactNode; children: React.ReactNode; dark?: boolean }) {
  return (
    <section id={id} className={`${dark ? "bg-[color:var(--color-dark)] text-[color:var(--color-primary-text-dark)]" : "bg-[color:var(--color-paper)] text-[color:var(--color-ink)]"} py-20 md:py-32`}>
      <div className="max-w-[1400px] mx-auto px-6 md:px-12">
        <div className="grid grid-cols-12 gap-6 mb-12 md:mb-20">
          <div className="col-span-12 md:col-span-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] mb-3" style={{ color: tokens.electricBlue }}>· {eyebrow}</div>
            <h2 className="text-3xl md:text-5xl font-semibold tracking-tight leading-[1.05]">{title}</h2>
          </div>
          {intro && <div className="col-span-12 md:col-span-7 md:col-start-6 text-base md:text-lg leading-relaxed" style={{ color: dark ? "rgba(229,234,242,0.75)" : tokens.inkSoft }}>{intro}</div>}
        </div>
        {children}
      </div>
    </section>
  );
}

function SDKShowcase() {
  return (
    <Section id="sdk" eyebrow="stage 4 · locked sdk" title={<>Workers import from <span className="font-serif-italic">one</span> locked SDK.</>} intro={<><code className="font-mono text-sm px-1.5 py-0.5 rounded bg-[color:var(--color-dark)] text-[color:var(--color-primary-text-dark)]">/src/sdk</code> is the only module workers are allowed to touch. Every archetype is a pre-built 1920×1080 motion-graphics composition. Every number goes through <code className="font-mono text-sm">kf()</code> keyframes.</>}>
      <div className="mb-14">
        <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-[color:var(--color-ink-soft)] mb-4">· design tokens</div>
        <div className="grid grid-cols-2 md:grid-cols-7 gap-3">
          {[{ name: "Paper", value: tokens.lightBg }, { name: "Dark", value: tokens.darkBg }, { name: "Ink", value: tokens.primaryText }, { name: "Electric Blue", value: tokens.electricBlue }, { name: "Coral Red", value: tokens.coralRed }, { name: "Serif Italic", value: "Instrument Serif" }, { name: "Mono", value: "JetBrains Mono" }].map((t) => (
            <div key={t.name} className="rounded-xl border border-[color:var(--color-rule)] bg-white p-4">
              <div className="h-10 rounded-md mb-3 border border-[color:var(--color-rule)]" style={{ background: t.value.startsWith("#") ? t.value : "transparent", fontFamily: t.name === "Serif Italic" ? tokens.fontFamilySerif : t.name === "Mono" ? tokens.fontFamilyMono : undefined, fontSize: t.name === "Serif Italic" || t.name === "Mono" ? 14 : undefined, color: t.name === "Serif Italic" || t.name === "Mono" ? tokens.primaryText : undefined, fontStyle: t.name === "Serif Italic" ? "italic" : undefined, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {t.name === "Serif Italic" && "Aa — Italic"}
                {t.name === "Mono" && "f=1/60"}
              </div>
              <div className="text-xs font-semibold text-[color:var(--color-ink)]">{t.name}</div>
              <div className="font-mono text-[10px] text-[color:var(--color-ink-soft)] uppercase tracking-widest">{t.value}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 space-y-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-[color:var(--color-ink-soft)] mb-2">· mg core</div>
          <PrimitiveCard name="kf(f, keys)" sig="kf(frame, [[0,0],[24,100,E.out]]) → value" body="Bezier keyframes — exactly like the graph editor in After Effects. Every value is a pure function of frame." />
          <PrimitiveCard name="Composition" sig="<Composition> 1920×1080 fixed comp" body="All scenes are designed at 1920×1080 and scaled as one picture. No responsive reflow — same as a video comp." />
          <PrimitiveCard name="Camera" sig="<Camera fx,fy,zoom>" body="2D camera push/pull, 3D dolly, parallax. Frames the world point at comp center." />
          <PrimitiveCard name="Rise / Words / Odometer" sig="Track-matte reveals + rolling digits" body="Masked type rises, word-by-word stagger with serif accent, rolling counter reels with motion blur." />
          <PrimitiveCard name="trim() / FilmFinish" sig="SVG trim-paths + film grain" body="Strokes draw on, rings trim, grain and vignette over the final frame — the motion-graphics finish." />
        </div>
        <div className="lg:col-span-7">
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-[color:var(--color-ink-soft)] mb-2">· 14 archetype layouts (hover to play)</div>
          <div className="grid grid-cols-2 gap-3">{ARCHETYPE_GALLERY.map((a) => <MiniArchetype key={a.name} name={a.name} mode={a.mode} grammar={a.grammar} shot={a.shot} />)}</div>
        </div>
      </div>
    </Section>
  );
}

function PrimitiveCard({ name, sig, body }: { name: string; sig: string; body: string }) {
  return (
    <div className="rounded-2xl border border-[color:var(--color-rule)] bg-white p-5">
      <div className="font-mono text-sm font-semibold text-[color:var(--color-ink)] mb-1">{name}</div>
      <code className="block font-mono text-[11px] text-[color:var(--color-electric)] mb-2 break-all">{sig}</code>
      <div className="text-sm text-[color:var(--color-ink-soft)] leading-relaxed">{body}</div>
    </div>
  );
}

const ARCHETYPE_GALLERY: {
  name: ArchetypeName;
  mode: "light" | "dark";
  grammar: string;
  shot: { archetype: ArchetypeName; durationFrames: number; mode: "light" | "dark"; content: SceneContent };
}[] = ALL_ARCHETYPES.map((name) => {
  const planned = SHOTS.find((s) => s.archetype === name);
  const mode = planned?.mode ?? ARCHETYPE_META[name].fixedMode ?? "light";
  return {
    name,
    mode,
    grammar: `${FAMILY_INFO[ARCHETYPE_META[name].family].label} · ${ARCHETYPE_META[name].grammar}`,
    shot: { archetype: name, durationFrames: planned?.durationFrames ?? 300, mode, content: planned?.content ?? {} },
  };
});

function MiniArchetype({ name, mode, grammar, shot }: { name: string; mode: "light" | "dark"; grammar: string; shot: (typeof ARCHETYPE_GALLERY)[number]["shot"]; }) {
  const [hover, setHover] = useState(false);
  const { frame, setFrame } = useFrameClock(hover, 0, 30);
  const localFrame = hover ? frame % shot.durationFrames : Math.min(150, shot.durationFrames - 40);
  return (
    <div className="group" onMouseEnter={() => { setFrame(0); setHover(true); }} onMouseLeave={() => setHover(false)}>
      <div className="relative rounded-xl border border-[color:var(--color-rule)] overflow-hidden bg-black">
        <ShotStill shot={{ ...shot, energy: 2 }} frame={localFrame} registry={ARCHETYPE_REGISTRY} />
        <div className="absolute top-2 left-2 z-20 font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-black/55 text-white">{hover ? `playing · f${localFrame.toString().padStart(3, "0")}` : "hover to play"}</div>
      </div>
      <div className="flex items-baseline justify-between gap-2 mt-2 px-0.5">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-[color:var(--color-ink)]">{name}</span>
        <span className="font-mono text-[9px] uppercase tracking-widest text-[color:var(--color-ink-soft)] text-right">{mode}</span>
      </div>
      <div className="text-[11px] text-[color:var(--color-ink-soft)] mt-0.5 px-0.5">{grammar}</div>
    </div>
  );
}

function MiddlewareCallout() {
  return (
    <div className="bg-[color:var(--color-dark)] text-[color:var(--color-primary-text-dark)] rounded-3xl p-8 md:p-12 border border-[color:var(--color-rule-dark)] overflow-hidden relative">
      <div className="font-mono text-[10px] uppercase tracking-[0.3em] mb-4" style={{ color: tokens.electricBlue }}>· stage 3 · frame-lock equations</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <Eq label="Shot boundary" formula="Shot[N].endFrame = round(sentences[endIdx].end × 60)" note="Float seconds → integer frames. Always." />
        <Eq label="Zero gap" formula="Shot[N].startFrame = Shot[N−1].endFrame" note="By construction. No timeline holes." />
        <Eq label="Word pre-roll" formula="localStartFrame = max(0, round((w.start − t₀) × 60) − 4)" note="4-frame vocal pre-roll so motion leads the voice." />
      </div>
    </div>
  );
}
function Eq({ label, formula, note }: { label: string; formula: string; note: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.25em] mb-2" style={{ color: tokens.inkSoft }}>{label}</div>
      <code className="block font-mono text-sm md:text-base mb-2" style={{ color: "#E5EAF2" }}>{formula}</code>
      <div className="text-xs" style={{ color: tokens.inkSoft }}>{note}</div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="bg-[color:var(--color-dark)] text-[color:var(--color-primary-text-dark)] border-t border-[color:var(--color-rule-dark)]">
      <div className="max-w-[1400px] mx-auto px-6 md:px-12 py-14 md:py-20 grid grid-cols-1 md:grid-cols-12 gap-10">
        <div className="md:col-span-6">
          <div className="text-5xl md:text-7xl font-semibold leading-[0.95] tracking-tight">Ship motion graphics<br /><span className="font-serif-italic" style={{ color: tokens.electricBlue }}>at the speed of speech.</span></div>
          <div className="mt-6 text-sm" style={{ color: tokens.inkSoft }}>frame/60 Studio — same locked 1920×1080 motion graphics engine, now with your audio. Same mg scenes, same transitions, same 60fps.</div>
        </div>
        <div className="md:col-span-2 md:col-start-9">
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] mb-3" style={{ color: tokens.inkSoft }}>· studio</div>
          <ul className="space-y-2 text-sm">
            <li><span className="opacity-60">Upload audio</span> → 60fps clock</li>
            <li><span className="opacity-60">Paste transcript</span> → 5 stages</li>
            <li>OpenAI Structured Outputs</li>
            <li>Local projects — no DB</li>
          </ul>
        </div>
        <div className="md:col-span-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] mb-3" style={{ color: tokens.inkSoft }}>· spec</div>
          <ul className="space-y-2 text-sm">
            <li><a href="#player" className="link-underline">Demo Film</a></li>
            <li><a href="#sdk" className="link-underline">MG Core</a></li>
            <li><a href="#schema" className="link-underline">Schema</a></li>
            <li><code className="text-xs">VITE_OPENAI_API_KEY</code> in .env</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-[color:var(--color-rule-dark)]">
        <div className="max-w-[1400px] mx-auto px-6 md:px-12 py-5 flex flex-wrap items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.3em]" style={{ color: tokens.inkSoft }}>
          <span>© frame/60 · deterministic video engine</span>
          <span>locked at <span style={{ color: tokens.electricBlue }}>60 fps</span> · your audio drives the clock</span>
        </div>
      </div>
    </footer>
  );
}

// ── App Shell with Studio + Project Management ──

type View = "landing" | "studio" | "projects";

export default function App() {
  // Studio is the default surface so audio + transcript upload is visible immediately.
  const [view, setView] = useState<View>("studio");
  const [activeId, setActiveId] = useState<string | null>(() => getActiveProjectId());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const { isDark, toggle: toggleTheme } = useTheme();
  const envStatus = getEnvStatus();

  useEffect(() => {
    // deep-link: #studio, #projects, #demo
    const hash = window.location.hash.replace("#", "");
    if (hash === "projects") setView("projects");
    else if (hash === "demo" || hash === "player") setView("landing");
    else setView("studio");
  }, []);

  const goStudio = (id?: string | null) => {
    if (id !== undefined) {
      setActiveId(id);
      if (id) setActiveProjectId(id);
      else setActiveProjectId(null);
    }
    setView("studio");
    window.location.hash = "studio";
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleCreateNew = () => {
    const p = createProject({ title: `Untitled Film — ${new Date().toLocaleDateString()}`, transcriptText: "", audioDurationSec: 0 });
    setRefreshKey((k) => k + 1);
    goStudio(p.id);
  };

  return (
    <div className="min-h-screen bg-[color:var(--color-surface-2)] text-[color:var(--color-text)]">
      {/* Global studio nav */}
      <div className="sticky top-0 z-50 bg-[color:var(--color-surface)]/85 backdrop-blur border-b border-[color:var(--color-border)]">
        <div className="max-w-[1600px] mx-auto px-5 md:px-8 h-14 flex items-center gap-2">
          <button onClick={() => goStudio(activeId)} className="flex items-center gap-2 font-black text-sm tracking-tight text-[color:var(--color-text)]">
            <span className="w-7 h-7 rounded-lg bg-[#0066FF] text-white grid place-items-center text-xs">60</span> FRAME/60
          </button>
          <div className="hidden md:flex items-center gap-1 ml-4 p-1 rounded-full bg-[color:var(--color-surface-3)] border border-[color:var(--color-border)]">
            <NavTab active={view === "studio"} onClick={() => goStudio(activeId)}>Studio</NavTab>
            <NavTab active={view === "projects"} onClick={() => { setView("projects"); window.location.hash = "projects"; }}>Projects</NavTab>
            <NavTab active={view === "landing"} onClick={() => { setView("landing"); window.location.hash = "demo"; window.scrollTo({ top: 0 }); }}>Demo & Docs</NavTab>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden sm:inline font-mono text-[11px] text-[color:var(--color-text-faint)]">{getProjects().length} project{getProjects().length !== 1 ? "s" : ""} · local</span>
            <button
              onClick={toggleTheme}
              aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
              title={isDark ? "Light mode" : "Dark mode"}
              className="p-2 rounded-full bg-[color:var(--color-surface)] border border-[color:var(--color-border)] text-[color:var(--color-text-soft)] hover:text-[color:var(--color-text)] hover:bg-[color:var(--color-surface-3)] transition-colors"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="px-3 py-1.5 rounded-full bg-[color:var(--color-surface)] border border-[color:var(--color-border)] text-xs font-medium text-[color:var(--color-text-soft)] hover:bg-[color:var(--color-surface-3)] flex items-center gap-1.5 transition-colors"
              title={`Active Endpoint: ${envStatus.routeName} (${envStatus.model}) · ${envStatus.codeConcurrency} parallel code agents`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${envStatus.configured ? "bg-emerald-500" : "bg-amber-500"}`} />
              <span>{envStatus.activeRoute === "route1" ? "AgentRouter" : "HCNSEC"}</span>
              <span className="text-[10px] opacity-60 font-mono">({envStatus.codeConcurrency}x)</span>
            </button>
            <button onClick={() => goStudio(null)} className="px-4 py-1.5 rounded-full bg-[#0066FF] text-white text-xs font-semibold hover:bg-[#0052cc]">New Film +</button>
          </div>
        </div>
      </div>

      {view === "studio" && <Studio activeProjectId={activeId} onProjectChange={() => setRefreshKey((k) => k + 1)} onProjectIdChange={setActiveId} onOpenSettings={() => setSettingsOpen(true)} />}
      {view === "projects" && <ProjectsDashboard onOpen={(id) => goStudio(id)} onCreateNew={handleCreateNew} refreshKey={refreshKey} />}

      {view === "landing" && (
        <>
          <Hero onGoStudio={() => goStudio(activeId)} />
          <Section id="player" eyebrow="live demo · 60fps" title={<>A <span className="font-serif-italic">ShotPlan</span>, played back.</>} intro={<>Fourteen shots, 67.5s, five families — the reference film. Your uploads render through the same 1920×1080 mg scenes, same transitions, same 60fps. Demo below is audio-free (rAF clock); Studio uses your audio as master clock.</>}>
            <ShotPlayer />
          </Section>
          <Section id="variety" eyebrow="variety planner · consistency kit" title={<>Fourteen grammars, five families, <span className="font-serif-italic">one film</span>.</>} intro={<>Before a frame is drawn, the planner assigns every shot a family, an archetype and a theme, and checks the whole film: no grammar twice in a row, no family run longer than two, 15% dark cap, every act ≥2 families. Same palette, timing, cut sweep and rail run under every shot.</>}>
            <VarietyAudit report={VARIETY_REPORT} />
          </Section>
          <Section id="pipeline" eyebrow="the 5-stage pipeline" title={<>From raw JSON to a <span className="font-serif-italic">frame-perfect</span> render.</>} intro={<>Linear and auditable: typed in/out per stage, unit-testable in isolation. Now wired to real uploads — see Studio.</>}>
            <Pipeline />
          </Section>
          <Section eyebrow="middleware · the math" title={<>Floats go in. <span className="font-serif-italic">Integers</span> come out.</>} intro={<>Stage 3 is pure TS — no LLM, no side effects. Your audio time ×60 → integer frame. One place where seconds become frames.</>}><MiddlewareCallout /></Section>
          <SDKShowcase />
          <Section id="schema" eyebrow="stage 2 · planner output" title={<>A strict schema the LLM <span className="font-serif-italic">cannot cheat</span>.</>} intro={<>Planner is forbidden from outputting timestamps — only sentence indices. Four clauses injected into every worker prompt.</>}>
            <Schema />
          </Section>
          <Section eyebrow="project layout" title={<>A repository you can <span className="font-serif-italic">navigate</span>.</>} intro={<>Each <code className="font-mono text-sm">/pipeline</code> file is one stage; <code className="font-mono text-sm">/sdk</code> is locked; generated shots land in <code className="font-mono text-sm">/generated</code>. Studio projects live in browser storage — no DB.</>}>
            <DirectoryTree />
          </Section>
          <Footer />
        </>
      )}

      {view !== "landing" && (
        <div className="py-8 text-center">
          <button onClick={() => { setView("landing"); window.location.hash = ""; }} className="font-mono text-xs tracking-widest uppercase text-zinc-500 hover:text-zinc-900">← Back to Demo & Docs</button>
        </div>
      )}

      {view !== "landing" && <Footer />}

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

function NavTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
        active
          ? "bg-[color:var(--color-text)] text-[color:var(--color-surface)]"
          : "text-[color:var(--color-text-soft)] hover:text-[color:var(--color-text)]"
      }`}
    >
      {children}
    </button>
  );
}
