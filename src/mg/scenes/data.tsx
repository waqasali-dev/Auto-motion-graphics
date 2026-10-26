// src/mg/scenes/data.tsx
// Graph scenes, composed in 1920x1080 comp pixels. Values draw with the voice;
// the camera moves with the data instead of sitting still above a card.

import { useId, type ReactNode } from "react";
import type { SceneProps } from "../../sdk/contract";
import { IMG } from "../../sdk/kit";
import {
  COLOR,
  SERIF,
  E,
  W,
  H,
  kf,
  tw,
  mix,
  clamp,
  shake,
  trim,
  Camera,
  Rise,
  Words,
  Odometer,
  Label,
  Heading,
  splitFigure,
  theme,
  type Key,
} from "../core";

// ──────────────────────────────────────────────────────────────────────────────
// ChartStory — a pen draws the line; the camera rides it, then pulls back
// ──────────────────────────────────────────────────────────────────────────────

export function ChartStory({ frame: f, mode = "light", content }: SceneProps) {
  const th = theme(mode);
  const gid = useId().replace(/:/g, "");
  const b = content?.beat;
  const series = b?.series ?? b?.bars?.map((x) => x.value) ?? [4, 9, 14, 21, 30, 38];
  const labels = b?.seriesLabels ?? series.map((_, i) => `W${i + 1}`);
  const [peakNum, peakUnit] = splitFigure(b?.figures?.[0]?.value ?? String(Math.max(...series)));
  const n = series.length;

  const X0 = 260;
  const X1 = 1680;
  const Y0 = 400;
  const Y1 = 900;
  const max = Math.max(...series) * 1.12 || 1;
  const pts = series.map((v, i) => [X0 + (n === 1 ? 0 : (i / (n - 1)) * (X1 - X0)), Y1 - (v / max) * (Y1 - Y0)] as [number, number]);
  const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  const cum = [0];
  seg.forEach((s) => cum.push(cum[cum.length - 1] + s));
  const total = cum[cum.length - 1] || 1;

  const D0 = 26;
  const D1 = 160;
  const drawKeys: Key[] = [
    [D0, 0],
    [D1, 1, E.inOut],
  ];
  const draw = kf(f, drawKeys);
  const reach = (frac: number) => {
    for (let k = D0; k <= D1; k++) if (kf(k, drawKeys) >= frac - 1e-4) return k;
    return D1;
  };

  let pen: [number, number] = pts[0];
  let rem = draw * total;
  for (let i = 0; i < seg.length; i++) {
    if (rem <= seg[i]) {
      const t = seg[i] ? rem / seg[i] : 0;
      pen = [mix(pts[i][0], pts[i + 1][0], t), mix(pts[i][1], pts[i + 1][1], t)];
      break;
    }
    rem -= seg[i];
    pen = pts[i + 1];
  }

  const follow = kf(f, [[0, 1], [D1, 1], [D1 + 42, 0, E.inOut]]);
  const zoom = kf(f, [[0, 1.5], [D1, 1.32], [D1 + 42, 1, E.inOut]]);
  const fx = mix(W / 2, pen[0], follow);
  const fy = mix(H / 2, pen[1], follow * 0.55);
  const peak = series.indexOf(Math.max(...series));
  const peakAt = reach(cum[peak] / total);
  const d = "M " + pts.map((p) => `${p[0]} ${p[1]}`).join(" L ");
  const area = `${d} L ${pts[n - 1][0]} ${Y1} L ${pts[0][0]} ${Y1} Z`;

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: `linear-gradient(160deg, ${th.bg} 0%, ${th.bg2} 100%)` }}>
      <Camera fx={fx} fy={fy} zoom={zoom}>
        <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          <defs>
            <linearGradient id={`${gid}a`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={th.accent} stopOpacity={th.dark ? 0.42 : 0.28} />
              <stop offset="100%" stopColor={th.accent} stopOpacity={0} />
            </linearGradient>
            <clipPath id={`${gid}c`}>
              <rect x={-1000} y={-1000} width={1000 + pen[0]} height={3000} />
            </clipPath>
          </defs>
          {[0, 1, 2, 3, 4].map((g) => {
            const y = Y1 - (g / 4) * (Y1 - Y0);
            return (
              <g key={g} opacity={tw(f, 4 + g * 3, 20)}>
                <line x1={-700} x2={W + 700} y1={y} y2={y} stroke={th.line} strokeWidth={2} />
                <text x={X0 - 40} y={y + 9} textAnchor="end" fontSize={26} fontWeight={600} fill={th.sub}>
                  {Math.round((max * g) / 4)}
                </text>
              </g>
            );
          })}
          <path d={area} fill={`url(#${gid}a)`} clipPath={`url(#${gid}c)`} />
          <path d={d} fill="none" stroke={th.accent} strokeWidth={18} strokeLinecap="round" strokeLinejoin="round" filter="url(#mgSoft)" {...trim(0, draw)} />
          <path d={d} fill="none" stroke={th.accent} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" {...trim(0, draw)} />
          {pts.map((p, i) => {
            const at = reach(cum[i] / total);
            const s = kf(f, [[at, 0], [at + 12, 1, E.back]]);
            return (
              <g key={i}>
                <circle cx={p[0]} cy={p[1]} r={Math.max(0, 13 * s)} fill={th.bg} stroke={th.accent} strokeWidth={6} />
                <text x={p[0]} y={Y1 + 62} textAnchor="middle" fontSize={28} fontWeight={700} fill={th.sub} opacity={clamp(s)}>
                  {labels[i] ?? ""}
                </text>
              </g>
            );
          })}
          <line
            x1={pts[peak][0]}
            x2={pts[peak][0]}
            y1={pts[peak][1]}
            y2={Y1}
            stroke={th.accent}
            strokeWidth={3}
            {...trim(0, tw(f, peakAt, 26, 0, 1, E.inOut))}
          />
          <circle cx={pen[0]} cy={pen[1]} r={draw > 0 && draw < 1 ? 18 : 0} fill={th.accent} filter="url(#mgGlow)" />
        </svg>
        <div
          style={{
            position: "absolute",
            left: pts[peak][0],
            top: pts[peak][1] - 46,
            transform: "translate(-50%, -100%)",
            display: "flex",
            alignItems: "baseline",
            gap: 14,
            whiteSpace: "nowrap",
          }}
        >
          <Odometer value={peakNum} f={f} at={peakAt} size={140} color={th.ink} />
          {peakUnit && (
            <Rise f={f} at={peakAt + 14} h={90}>
              <span style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 90, color: th.accent }}>{peakUnit}</span>
            </Rise>
          )}
        </div>
      </Camera>
      <Heading f={f} at={4} kicker={b?.kicker ?? "trend"} text={b?.headline ?? "Revisions compound every week."} accent={b?.accentWord} th={th} size={70} width={1100} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// BarComparison — bars grow from a drawn baseline; the winner is singled out
// ──────────────────────────────────────────────────────────────────────────────

export function BarComparison({ frame: f, duration, mode = "light", content }: SceneProps) {
  const th = theme(mode);
  const b = content?.beat;
  const bars = b?.bars ?? [
    { label: "Manual timeline", value: 100 },
    { label: "Agency review", value: 62 },
    { label: "Frame/60 pass", value: 2 },
  ];
  const fig = b?.figures?.[0] ?? { value: "−98%", label: "time to a finished cut" };
  const n = bars.length;
  const max = Math.max(...bars.map((x) => x.value)) || 1;
  const lowest = bars.reduce((best, x, i) => (x.value < bars[best].value ? i : best), 0);

  const BASE = 900;
  const MAXH = 540;
  const BW = 270;
  const GAP = 80;
  const X0 = 130;
  const focusAt = 118;
  const dim = tw(f, focusAt, 24);
  const sh = shake(f, focusAt + 22, 16, 16);
  const push = kf(f, [[0, 1], [duration, 1.05, E.linear]]);

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: `linear-gradient(160deg, ${th.bg} 0%, ${th.bg2} 100%)` }}>
      <div style={{ position: "absolute", inset: 0, transform: `translate(${sh.x}px, ${sh.y}px) scale(${push})`, transformOrigin: "40% 70%" }}>
        <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
          <line x1={X0 - 40} x2={X0 + n * BW + (n - 1) * GAP + 40} y1={BASE} y2={BASE} stroke={th.ink} strokeWidth={4} {...trim(0, tw(f, 8, 30, 0, 1, E.inOut))} />
        </svg>
        {bars.map((bar, i) => {
          const g = kf(f, [[26 + i * 10, 0], [82 + i * 10, 1, E.out]]);
          const h = Math.max(14, (bar.value / max) * MAXH * g);
          const x = X0 + i * (BW + GAP);
          const hi = i === lowest;
          const fill = hi && dim > 0 ? th.accent : th.ink;
          return (
            <div key={`${bar.label}-${i}`}>
              <div
                style={{
                  position: "absolute",
                  left: x,
                  top: BASE - h,
                  width: BW,
                  height: h,
                  background: fill,
                  opacity: hi ? 1 : 1 - 0.72 * dim,
                  boxShadow: hi && dim > 0 ? `0 0 ${80 * dim}px ${th.accent}` : undefined,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: x,
                  top: BASE - h - 100,
                  width: BW,
                  fontSize: 80,
                  fontWeight: 800,
                  letterSpacing: "-0.05em",
                  color: fill,
                  opacity: (hi ? 1 : 1 - 0.6 * dim) * clamp(g * 3),
                }}
              >
                {Math.round(bar.value * g)}
              </div>
              <div style={{ position: "absolute", left: x, top: BASE + 30, width: BW + 40 }}>
                <Rise f={f} at={30 + i * 10} h={26}>
                  <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: th.sub }}>{bar.label}</span>
                </Rise>
              </div>
            </div>
          );
        })}
        <div style={{ position: "absolute", left: 1230, top: 400 }}>
          <Odometer value={fig.value} f={f} at={focusAt + 8} size={230} color={th.accent} />
          <div style={{ marginTop: 18 }}>
            <Rise f={f} at={focusAt + 24} h={32}>
              <span style={{ fontSize: 32, fontWeight: 600, color: th.sub }}>{fig.label}</span>
            </Rise>
          </div>
        </div>
      </div>
      <Heading f={f} at={2} kicker={b?.kicker ?? "comparison"} text={b?.headline ?? "Build time fell on every stage."} accent={b?.accentWord} th={th} size={70} width={1500} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// PerspectiveDataGrid — a perspective floor flies under a rolling counter
// ──────────────────────────────────────────────────────────────────────────────

export function PerspectiveDataGrid({ frame: f, content }: SceneProps) {
  const b = content?.beat;
  const fig = b?.figures?.[0] ?? { value: "18 / 18", label: "shots locked" };
  const m = fig.value.match(/(\d+)\s*\/\s*(\d+)/);
  const total = m ? Math.min(24, Number(m[2])) : 12;
  const lit = m ? Math.min(total, Number(m[1])) : total;
  const tilt = kf(f, [[0, 70], [80, 80, E.out]]);
  const rise = kf(f, [[0, 260], [60, 0, E.out]]);

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "linear-gradient(180deg,#03050D 0%,#081130 55%,#0B1A44 100%)" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 560, height: 260, background: "radial-gradient(50% 50% at 50% 50%, rgba(70,140,255,0.45), transparent)", filter: "blur(30px)" }} />
      <div style={{ position: "absolute", inset: 0, perspective: 1000, perspectiveOrigin: "50% 40%" }}>
        <div
          style={{
            position: "absolute",
            left: W / 2 - 3000,
            top: H + 200 - 3200,
            width: 6000,
            height: 3200,
            transformOrigin: "50% 100%",
            transform: `translateY(${rise}px) rotateX(${tilt}deg)`,
            backgroundImage:
              "linear-gradient(rgba(90,160,255,0.55) 3px, transparent 3px), linear-gradient(90deg, rgba(90,160,255,0.55) 3px, transparent 3px)",
            backgroundSize: "180px 180px",
            backgroundPosition: `0px ${f * 7}px`,
            maskImage: "linear-gradient(to top, black 25%, transparent 92%)",
            WebkitMaskImage: "linear-gradient(to top, black 25%, transparent 92%)",
          }}
        />
      </div>

      <div style={{ position: "absolute", left: 0, right: 0, top: 120, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <Label text={b?.kicker ?? "timing lock"} f={f} at={6} color="rgba(255,255,255,0.7)" lineColor="#4D94FF" />
        <div style={{ height: 26 }} />
        <Odometer value={fig.value} f={f} at={14} size={230} color="#fff" />
        <div style={{ height: 18 }} />
        <Rise f={f} at={30} h={32}>
          <span style={{ fontSize: 32, fontWeight: 700, letterSpacing: "0.24em", textTransform: "uppercase", color: "rgba(255,255,255,0.6)" }}>{fig.label}</span>
        </Rise>
        <div style={{ display: "flex", gap: 16, marginTop: 40 }}>
          {Array.from({ length: total }).map((_, i) => {
            const on = i < lit ? tw(f, 64 + i * 3, 10) : 0;
            return (
              <div
                key={i}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: on > 0.5 ? "#4D94FF" : "rgba(255,255,255,0.14)",
                  boxShadow: on > 0.5 ? "0 0 24px #4D94FF" : undefined,
                  transform: `scale(${1 + on * 0.25 - Math.max(0, on - 0.9)})`,
                }}
              />
            );
          })}
        </div>
        <div style={{ height: 36 }} />
        <Words text={b?.headline ?? "Every shot carries its own timing proof."} f={f} at={40} size={52} weight={600} color="#fff" align="center" width={1400} />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// BentoBadgeCluster — full-frame block wipes build a typographic grid
// ──────────────────────────────────────────────────────────────────────────────

type Dir = "l" | "r" | "u" | "d";

function wipe(dir: Dir, t: number): string {
  const k = (1 - t) * 100;
  if (dir === "l") return `inset(0 ${k}% 0 0)`;
  if (dir === "r") return `inset(0 0 0 ${k}%)`;
  if (dir === "u") return `inset(${k}% 0 0 0)`;
  return `inset(0 0 ${k}% 0)`;
}

export function BentoBadgeCluster({ frame: f, duration, content }: SceneProps) {
  const b = content?.beat;
  const head = b?.headline ?? "No raw CSS. One locked SDK.";
  const fig = b?.figures?.[0];
  const [fNum, fUnit] = fig ? splitFigure(fig.value) : ["01", ""];
  const kicker = b?.kicker ?? "sdk · locked";
  const img = b?.image ?? IMG.flatlay;
  const CW = W / 4;
  const CH = H / 2;
  const push = kf(f, [[0, 1], [duration, 1.05, E.linear]]);

  const cells: { c: number; r: number; w: number; h: number; dir: Dir; bg: string; at: number; node: ReactNode }[] = [
    {
      c: 0,
      r: 0,
      w: 2,
      h: 1,
      dir: "l",
      bg: COLOR.blue,
      at: 4,
      node: (
        <div style={{ position: "absolute", left: 80, right: 80, bottom: 70 }}>
          <Words text={head} f={f} at={18} size={92} weight={800} color="#fff" width={800} />
        </div>
      ),
    },
    {
      c: 2,
      r: 0,
      w: 1,
      h: 1,
      dir: "d",
      bg: COLOR.ink,
      at: 10,
      node: (
        <div style={{ position: "absolute", left: 60, bottom: 64, color: "#fff" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <Odometer value={fNum} f={f} at={24} size={170} color="#fff" />
            {fUnit && <span style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 80 }}>{fUnit}</span>}
          </div>
          <div style={{ marginTop: 14 }}>
            <Rise f={f} at={34} h={24}>
              <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", opacity: 0.65 }}>{fig?.label ?? "locked sdk"}</span>
            </Rise>
          </div>
        </div>
      ),
    },
    {
      c: 3,
      r: 0,
      w: 1,
      h: 2,
      dir: "u",
      bg: "#111",
      at: 16,
      node: (
        <img
          src={img}
          alt=""
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: `scale(${kf(f, [[16, 1.3], [duration, 1.05, E.soft]])})` }}
        />
      ),
    },
    {
      c: 0,
      r: 1,
      w: 1,
      h: 1,
      dir: "r",
      bg: "#EFE6D6",
      at: 22,
      node: (
        <div style={{ position: "absolute", left: 60, bottom: 64 }}>
          <Words text={kicker} f={f} at={34} size={78} weight={400} color={COLOR.ink} accent={kicker} accentColor={COLOR.ink} tracking={-0.01} />
        </div>
      ),
    },
    {
      c: 1,
      r: 1,
      w: 2,
      h: 1,
      dir: "l",
      bg: "#0B0E14",
      at: 28,
      node: (
        <>
          <img
            src={IMG.dark}
            alt=""
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.75, transform: `translateX(${kf(f, [[28, 60], [duration, -40, E.linear]])}px) scale(1.15)` }}
          />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(5,7,12,0.85), transparent 70%)" }} />
          <div style={{ position: "absolute", left: 60, bottom: 64 }}>
            <Label text="every shot · same kit" f={f} at={44} color="#fff" lineColor={COLOR.blue} />
          </div>
        </>
      ),
    },
  ];

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#F4F6F9" }}>
      <div style={{ position: "absolute", inset: 0, transform: `scale(${push})` }}>
        {cells.map((c, i) => {
          const t = kf(f, [[c.at, 0], [c.at + 22, 1, E.inOut]]);
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: c.c * CW,
                top: c.r * CH,
                width: c.w * CW,
                height: c.h * CH,
                background: c.bg,
                overflow: "hidden",
                clipPath: wipe(c.dir, t),
              }}
            >
              {c.node}
            </div>
          );
        })}
      </div>
    </div>
  );
}
