// src/mg/scenes/case.tsx
// Connected-system and investigation scenes, composed in 1920x1080 comp pixels.

import type { Beat, SceneProps } from "../../sdk/contract";
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
  wiggle,
  shake,
  mb,
  trim,
  circlePath,
  Camera,
  Rise,
  Words,
  Odometer,
  Label,
  Heading,
  theme,
  type Key,
} from "../core";

// ──────────────────────────────────────────────────────────────────────────────
// NetworkMesh — start tight on the planner, pull back to reveal the system
// ──────────────────────────────────────────────────────────────────────────────

const MESH_LABELS = ["Transcript", "Planner", "Worker 01", "Worker 02", "Worker 03", "Worker 04", "Worker 05", "Validator"];

export function NetworkMesh({ frame: f, mode = "light", content, energy }: SceneProps) {
  const th = theme(mode);
  const b = content?.beat;
  const labels = MESH_LABELS.map((d, i) => b?.nodes?.[i] ?? d);
  const cols = [300, 760, 1230, 1650];
  const pos: [number, number][] = [
    [cols[0], 620],
    [cols[1], 620],
    ...[0, 1, 2, 3, 4].map((k) => [cols[2], 360 + k * 130] as [number, number]),
    [cols[3], 620],
  ];
  const edges: [number, number][] = [[0, 1], ...[2, 3, 4, 5, 6].map((j) => [1, j] as [number, number]), ...[2, 3, 4, 5, 6].map((j) => [j, 7] as [number, number])];
  const pull = kf(f, [[0, 0], [16, 0], [96, 1, E.inOut]]);
  const zoom = mix(2.4, 1, pull);
  const fx = mix(pos[1][0], W / 2, pull);
  const fy = mix(pos[1][1], H / 2 + 40, pull);
  const speed = 0.7 + (energy ?? 2) * 0.25;
  const hub = (i: number) => i === 1 || i === 7;

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: `linear-gradient(160deg, ${th.bg} 0%, ${th.bg2} 100%)` }}>
      <Camera fx={fx} fy={fy} zoom={zoom}>
        <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          {edges.map(([a, c], e) => {
            const [x1, y1] = pos[a];
            const [x2, y2] = pos[c];
            const mx = (x1 + x2) / 2;
            const d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
            const at = 22 + e * 5;
            const t = kf(f, [[at, 0], [at + 26, 1, E.inOut]]);
            const live = f > at + 26;
            const u = (((f - at - 26) * 0.011 * speed + e * 0.13) % 1 + 1) % 1;
            return (
              <g key={e}>
                <path d={d} fill="none" stroke={th.line} strokeWidth={3} />
                <path d={d} fill="none" stroke={th.accent} strokeWidth={4} strokeLinecap="round" {...trim(0, t)} />
                {live && (
                  <path
                    d={d}
                    fill="none"
                    stroke={th.accent}
                    strokeWidth={9}
                    strokeLinecap="round"
                    filter="url(#mgGlow)"
                    pathLength={1}
                    strokeDasharray="0.07 2"
                    strokeDashoffset={-(u * 1.07 - 0.07)}
                  />
                )}
              </g>
            );
          })}
          {pos.map(([x, y], i) => {
            const at = 10 + i * 4;
            const s = kf(f, [[at, 0], [at + 14, 1, E.back]]);
            const ring = ((f + i * 13) % 70) / 70;
            const r = hub(i) ? 30 : 20;
            return (
              <g key={i}>
                <circle cx={x} cy={y} r={r + ring * 46} fill="none" stroke={th.accent} strokeWidth={2} opacity={(1 - ring) * 0.5 * clamp(s)} />
                <circle cx={x} cy={y} r={Math.max(0, r * s)} fill={hub(i) ? th.accent : th.ink} />
              </g>
            );
          })}
        </svg>
        {pos.map(([x, y], i) => {
          const below = i < 2 || i === 7;
          return (
            <div
              key={`l${i}`}
              style={{
                position: "absolute",
                left: below ? x : x + 44,
                top: below ? y + 52 : y,
                transform: below ? "translateX(-50%)" : "translateY(-50%)",
                textAlign: below ? "center" : "left",
                whiteSpace: "nowrap",
              }}
            >
              <Rise f={f} at={14 + i * 4} h={34}>
                <span style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.02em", color: th.ink }}>{labels[i]}</span>
              </Rise>
            </div>
          );
        })}
      </Camera>
      <Heading f={f} at={84} kicker={b?.kicker ?? "parallel workers"} text={b?.headline ?? "One planner. Five workers. One validator."} accent={b?.accentWord} th={th} size={66} width={1050} y={84} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// RadialHub — rings trim on around a rolling number; labels orbit
// ──────────────────────────────────────────────────────────────────────────────

export function RadialHub({ frame: f, mode = "light", content }: SceneProps) {
  const th = theme(mode);
  const b = content?.beat;
  const fig = b?.figures?.[0] ?? { value: "0", label: "frames of drift" };
  const items = b?.nodes?.slice(1) ?? ["Frame", "Shot", "Render", "Check", "Master"];
  const CX = 1250;
  const CY = 560;
  const pull = kf(f, [[0, 0], [80, 1, E.inOut]]);
  const zoom = mix(1.8, 1, pull);
  const fx = mix(CX, W / 2, pull);
  const fy = mix(CY, H / 2, pull);
  const arc = kf(f, [[30, 0], [90, 0.3, E.inOut]]);

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: `radial-gradient(70% 90% at 65% 50%, #FFFFFF 0%, ${th.bg} 55%, ${th.bg2} 100%)` }}>
      <Camera fx={fx} fy={fy} zoom={zoom}>
        <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          {[150, 250, 350, 450].map((r, i) => (
            <path key={r} d={circlePath(CX, CY, r)} fill="none" stroke={th.line} strokeWidth={2.5} {...trim(0, kf(f, [[6 + i * 5, 0], [50 + i * 5, 1, E.inOut]]))} />
          ))}
          <g transform={`rotate(${f * 0.25} ${CX} ${CY})`} opacity={tw(f, 30, 20)}>
            <path d={circlePath(CX, CY, 300)} fill="none" stroke={th.ink} strokeWidth={3} strokeDasharray="6 22" opacity={0.35} />
          </g>
          <g transform={`rotate(${f * 0.4} ${CX} ${CY})`}>
            <path d={circlePath(CX, CY, 450)} fill="none" stroke={th.accent} strokeWidth={10} strokeLinecap="round" filter="url(#mgGlow)" {...trim(0, arc)} />
          </g>
        </svg>
        <div style={{ position: "absolute", left: CX, top: CY, transform: "translate(-50%, -54%)", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <Odometer value={fig.value} f={f} at={18} size={320} color={th.ink} />
          <div style={{ marginTop: 6 }}>
            <Rise f={f} at={34} h={26}>
              <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: "0.24em", textTransform: "uppercase", color: th.sub }}>{fig.label}</span>
            </Rise>
          </div>
        </div>
        {items.map((it, i) => {
          const ang = ((-90 + i * (360 / items.length) + f * 0.05) * Math.PI) / 180;
          const r = 380;
          const x = CX + Math.cos(ang) * r;
          const y = CY + Math.sin(ang) * r;
          const s = kf(f, [[40 + i * 8, 0], [54 + i * 8, 1, E.back]]);
          const right = Math.cos(ang) >= 0;
          return (
            <div key={it} style={{ position: "absolute", left: x, top: y, transform: `translate(-50%, -50%) scale(${s})` }}>
              <div style={{ width: 18, height: 18, borderRadius: "50%", background: th.accent, boxShadow: `0 0 0 10px ${th.accentSoft}` }} />
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: right ? 40 : undefined,
                  right: right ? undefined : 40,
                  transform: "translateY(-50%)",
                  fontSize: 34,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  color: th.ink,
                  whiteSpace: "nowrap",
                }}
              >
                {it}
              </div>
            </div>
          );
        })}
      </Camera>
      <div style={{ position: "absolute", left: 110, top: 360, width: 540 }}>
        <Label text={b?.kicker ?? "drift audit"} f={f} at={60} color={th.sub} lineColor={th.accent} />
        <div style={{ height: 26 }} />
        <Words text={b?.headline ?? "Every word lands on an integer frame."} f={f} at={66} size={58} weight={700} color={th.ink} accent={b?.accentWord} accentColor={th.accent} lh={1.06} />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// InvestigationBoard — camera travels card to card, string draws, stamp lands
// ──────────────────────────────────────────────────────────────────────────────

const BOARD_DEFAULT = [
  { tag: "input", title: "Transcript.json", note: "1,092 words · ASR confidence kept" },
  { tag: "plan", title: "ShotPlan.json", note: "14 shots · indices, never floats" },
  { tag: "render", title: "Master.mp4", note: "60 fps · zero timeline gaps" },
];
const BOARD_POS = [
  { x: -760, y: 50, r: -4 },
  { x: 0, y: -70, r: 3 },
  { x: 760, y: 70, r: -2 },
];

export function InvestigationBoard({ frame: f, content }: SceneProps) {
  const b = content?.beat;
  const items = (b?.evidence ?? BOARD_DEFAULT).slice(0, 3);
  const land = (i: number) => 18 + i * 64;
  const last = items.length - 1;
  const L2 = land(last);

  const fxKeys: Key[] = [[0, BOARD_POS[0].x], [land(0) + 34, BOARD_POS[0].x]];
  const fyKeys: Key[] = [[0, BOARD_POS[0].y], [land(0) + 34, BOARD_POS[0].y]];
  for (let i = 1; i <= last; i++) {
    fxKeys.push([land(i) - 6, BOARD_POS[i].x, E.inOut], [land(i) + 34, BOARD_POS[i].x]);
    fyKeys.push([land(i) - 6, BOARD_POS[i].y, E.inOut], [land(i) + 34, BOARD_POS[i].y]);
  }
  fxKeys.push([L2 + 80, 0, E.inOut]);
  fyKeys.push([L2 + 80, 0, E.inOut]);
  const fx = kf(f, fxKeys);
  const fy = kf(f, fyKeys);
  const zoom = kf(f, [[0, 1.6], [L2 + 40, 1.55], [L2 + 80, 0.84, E.inOut]]);
  const focusAmt = clamp((zoom - 0.84) / 0.7);
  const stampAt = L2 + 86;
  const sh = shake(f, stampAt + 6, 18, 20);

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#0C0A08" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: W,
          height: H,
          transformOrigin: "0 0",
          transform: `translate(${W / 2 + sh.x}px, ${H / 2 + sh.y}px) scale(${zoom}) translate(${-fx}px, ${-fy}px)`,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: -1900,
            top: -1100,
            width: 3800,
            height: 2200,
            background: "radial-gradient(60% 60% at 50% 45%, #2A231A 0%, #17130E 70%, #0C0A08 100%)",
          }}
        >
          <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(rgba(255,235,205,0.06) 2px, transparent 2px)", backgroundSize: "34px 34px" }} />
        </div>
        <svg width={3800} height={2200} viewBox="-1900 -1100 3800 2200" style={{ position: "absolute", left: -1900, top: -1100, overflow: "visible" }}>
          {items.slice(0, -1).map((_, i) => {
            const a = BOARD_POS[i];
            const c = BOARD_POS[i + 1];
            const d = `M ${a.x} ${a.y - 160} Q ${(a.x + c.x) / 2} ${(a.y + c.y) / 2 + 40} ${c.x} ${c.y - 160}`;
            return <path key={i} d={d} fill="none" stroke={COLOR.coral} strokeWidth={6} strokeLinecap="round" filter="url(#mgGlow)" {...trim(0, kf(f, [[land(i + 1) - 4, 0], [land(i + 1) + 36, 1, E.inOut]]))} />;
          })}
        </svg>
        {items.map((it, i) => {
          const p = BOARD_POS[i];
          const t = kf(f, [[land(i), 0], [land(i) + 16, 1, E.out]]);
          const blur = (Math.abs(p.x - fx) / 760) * 8 * focusAmt;
          return (
            <div
              key={`${it.title}-${i}`}
              style={{
                position: "absolute",
                left: p.x - 290,
                top: p.y - 200,
                width: 580,
                height: 400,
                background: "#F2ECE1",
                color: "#1B1A17",
                padding: "64px 56px",
                boxSizing: "border-box",
                transform: `rotate(${p.r + (1 - t) * 8}deg) scale(${mix(1.35, 1, t)})`,
                opacity: clamp(t * 2),
                boxShadow: `0 ${mix(80, 30, t)}px ${mix(120, 60, t)}px rgba(0,0,0,0.55)`,
                filter: blur > 0.3 ? `blur(${blur}px)` : undefined,
              }}
            >
              <div style={{ position: "absolute", left: "50%", top: -18, width: 36, height: 36, marginLeft: -18, borderRadius: "50%", background: "radial-gradient(circle at 35% 35%, #FF8A84, #E53935 60%, #8E1B17)", boxShadow: "0 8px 14px rgba(0,0,0,0.5)" }} />
              <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "0.26em", textTransform: "uppercase", color: "#B45309" }}>{it.tag}</div>
              <div style={{ fontSize: 58, fontWeight: 800, letterSpacing: "-0.035em", marginTop: 18 }}>{it.title}</div>
              <div style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 38, lineHeight: 1.2, color: "#5B584F", marginTop: 16 }}>{it.note}</div>
            </div>
          );
        })}
        <div
          style={{
            position: "absolute",
            left: 560,
            top: -420,
            transform: `translate(-50%, -50%) rotate(-9deg) scale(${kf(f, [[stampAt, 2.6], [stampAt + 10, 1, E.out]])})`,
            opacity: tw(f, stampAt, 4),
            border: `12px solid ${COLOR.coral}`,
            color: COLOR.coral,
            padding: "10px 40px",
            fontSize: 120,
            fontWeight: 800,
            letterSpacing: "0.12em",
          }}
        >
          VERIFIED
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 380, background: "linear-gradient(180deg, rgba(8,7,5,0.85), transparent)" }} />
      <Heading
        f={f}
        at={4}
        kicker={b?.kicker ?? "case 04 · the audit"}
        text={b?.headline ?? "Every cut traces back to one transcript."}
        accent={b?.accentWord}
        th={{ ...theme("dark"), accent: "#FF8A80" }}
        size={64}
        width={1200}
        y={84}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// MagnifierInspect — a word stream pans by; a lens locks on the wrong word
// ──────────────────────────────────────────────────────────────────────────────

type Row = NonNullable<Beat["rows"]>[number];

const DEFAULT_ROWS: Row[] = [
  { cells: ["00:38.10", "this", "0.99"] },
  { cells: ["00:38.34", "forty", "0.98"] },
  { cells: ["00:38.71", "second", "0.97"] },
  { cells: ["00:39.02", "spot", "0.99"] },
  { cells: ["00:39.40", "took", "0.98"] },
  { cells: ["00:40.06", "lowcon fidence", "0.42"], flag: true, fix: "low-confidence" },
  { cells: ["00:40.40", "just", "0.96"] },
  { cells: ["00:40.71", "20 mins", "0.99"] },
];

export function MagnifierInspect({ frame: f, mode = "light", content }: SceneProps) {
  const th = theme(mode);
  const b = content?.beat;
  const rows = b?.rows ?? DEFAULT_ROWS;
  const flag = Math.max(0, rows.findIndex((r) => r.flag));
  const slots = rows.map((r) => Math.max(280, r.cells[1].length * 66 + 130));
  const xs: number[] = [];
  slots.reduce((acc, s) => {
    xs.push(acc + s / 2);
    return acc + s;
  }, 0);

  const lock = 30 + flag * 14 + 18;
  const fixAt = lock + 34;
  const fx = kf(f, [[0, xs[0]], [18, xs[0]], [lock - 4, xs[flag], E.inOut]]);
  const zoom = kf(f, [[0, 0.92], [lock - 4, 1], [lock + 24, 1.3, E.inOut]]);
  const flagged = rows[flag];
  const conf = flagged.cells[2];
  const ring = kf(f, [[lock - 8, 0], [lock + 14, 1, E.inOut]]);

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: `linear-gradient(160deg, ${th.bg} 0%, ${th.bg2} 100%)` }}>
      <Camera fx={fx} fy={560} zoom={zoom}>
        {rows.map((r, i) => {
          const isFlag = i === flag;
          const lowConf = parseFloat(r.cells[2]) < 0.5;
          const red = isFlag && f >= lock;
          const glitch = isFlag && f >= lock && f < fixAt;
          const bar = tw(f, 8 + i * 6, 24);
          return (
            <div key={i} style={{ position: "absolute", left: xs[i] - slots[i] / 2, top: 400, width: slots[i], textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: "0.12em", color: th.sub, marginBottom: 24 }}>{r.cells[0]}</div>
              <div style={{ position: "relative", height: 140, fontSize: 120, fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1.1, whiteSpace: "nowrap" }}>
                {glitch && (
                  <>
                    <div style={{ position: "absolute", inset: 0, color: "#00D1FF", opacity: 0.7, transform: `translateX(${wiggle(f, 22, 16, 1)}px)` }}>{r.cells[1]}</div>
                    <div style={{ position: "absolute", inset: 0, color: COLOR.coral, opacity: 0.7, transform: `translateX(${wiggle(f, 22, 16, 5)}px)` }}>{r.cells[1]}</div>
                  </>
                )}
                <div style={{ position: "absolute", inset: 0, color: red ? COLOR.coral : th.ink }}>
                  {isFlag ? (
                    <Rise f={f} at={-30} h={120} out={fixAt}>
                      {r.cells[1]}
                    </Rise>
                  ) : (
                    r.cells[1]
                  )}
                </div>
                {isFlag && (
                  <div style={{ position: "absolute", inset: 0, color: th.accent }}>
                    <Rise f={f} at={fixAt + 8} h={120}>
                      {r.fix ?? r.cells[1]}
                    </Rise>
                  </div>
                )}
              </div>
              <div style={{ margin: "26px auto 0", width: slots[i] * 0.7, height: 8, background: th.line, borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${parseFloat(r.cells[2]) * 100 * bar}%`, height: "100%", background: lowConf ? COLOR.coral : th.accent }} />
              </div>
            </div>
          );
        })}
      </Camera>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }}>
        <path d={circlePath(W / 2, 545, 250)} fill="none" stroke={th.accent} strokeWidth={6} {...trim(0, ring)} />
        {[0, 90, 180, 270].map((a) => (
          <line
            key={a}
            x1={W / 2}
            y1={545 - 270}
            x2={W / 2}
            y2={545 - 320}
            stroke={th.accent}
            strokeWidth={6}
            opacity={ring}
            transform={`rotate(${a + (1 - ring) * 45} ${W / 2} 545)`}
          />
        ))}
      </svg>
      <div style={{ position: "absolute", left: 0, right: 0, top: 860, display: "flex", alignItems: "center", justifyContent: "center", gap: 36 }}>
        {f >= lock && <Odometer value={conf} f={f} at={lock + 4} size={110} color={COLOR.coral} dur={30} />}
        <div style={{ position: "relative", width: 760, height: 40 }}>
          <div style={{ position: "absolute", left: 0, top: 0 }}>
            <Rise f={f} at={lock + 10} h={28} out={fixAt}>
              <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: th.sub }}>asr confidence · below 0.50</span>
            </Rise>
          </div>
          <div style={{ position: "absolute", left: 0, top: 0 }}>
            <Rise f={f} at={fixAt + 12} h={28}>
              <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: th.accent }}>display fixed · timestamps untouched</span>
            </Rise>
          </div>
        </div>
      </div>
      <Heading f={f} at={2} kicker={b?.kicker ?? "inspection"} text={b?.headline ?? "One word was wrong. The lens found it."} accent={b?.accentWord} th={th} size={62} width={1200} y={80} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// QueryTrace — a giant query types itself, then ranked results fly in
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_RESULTS = [
  { title: "Scrubbing frames by hand", source: "edit log · day 2", score: 0.94 },
  { title: "Re-exporting after each note", source: "review thread · v3", score: 0.81 },
  { title: "Waiting on a render queue", source: "ops log · Friday", score: 0.67 },
];

export function QueryTrace({ frame: f, mode = "light", content }: SceneProps) {
  const th = theme(mode);
  const b = content?.beat;
  const query = b?.query ?? "where did the time go";
  const results = (b?.results ?? DEFAULT_RESULTS).slice(0, 4);
  const typeAt = 10;
  const cps = 2.2;
  const typed = query.slice(0, clamp(Math.floor((f - typeAt) / cps), 0, query.length));
  const doneAt = typeAt + Math.ceil(query.length * cps);
  const moveAt = doneAt + 16;
  const mv = kf(f, [[moveAt, 0], [moveAt + 28, 1, E.inOut]]);
  const caretOn = f < doneAt || Math.floor(f / 16) % 2 === 0;

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: `linear-gradient(160deg, ${th.bg} 0%, ${th.bg2} 100%)` }}>
      <div style={{ position: "absolute", left: 140, top: 84 }}>
        <Label text={b?.kicker ?? "search · trace"} f={f} at={0} color={th.sub} lineColor={th.accent} />
      </div>
      <div
        style={{
          position: "absolute",
          left: 140,
          top: mix(450, 160, mv),
          transform: `scale(${mix(1, 0.5, mv)})`,
          transformOrigin: "0 0",
          width: 1640,
        }}
      >
        <div style={{ fontSize: 132, fontWeight: 700, letterSpacing: "-0.045em", color: th.ink, whiteSpace: "nowrap", height: 160, display: "flex", alignItems: "center" }}>
          {typed}
          <span style={{ display: "inline-block", width: 10, height: 120, marginLeft: 14, background: th.accent, opacity: caretOn ? 1 : 0 }} />
        </div>
        <div style={{ marginTop: 18, height: 5, width: `${tw(f, 4, 40, 0, 100, E.inOut)}%`, background: th.ink, opacity: 0.18 }} />
      </div>

      {results.map((r, i) => {
        const at = moveAt + 18 + i * 7;
        const x = (fr: number) => kf(fr, [[at, 760], [at + 26, 0, E.out]]);
        const xv = x(f);
        const top = i === 0;
        const hl = tw(f, at + 32, 22, 0, 100, E.inOut);
        const line = tw(f, at + 10, 34, 0, 1, E.inOut);
        return (
          <div
            key={`${r.title}-${i}`}
            style={{
              position: "absolute",
              left: 140,
              top: 330 + i * 150,
              width: 1640,
              height: 130,
              transform: `translateX(${xv}px)`,
              opacity: tw(f, at, 10),
              filter: mb(xv - x(f - 1)),
              display: "flex",
              alignItems: "center",
            }}
          >
            <div style={{ width: 170, fontFamily: SERIF, fontStyle: "italic", fontSize: 100, color: top ? th.accent : th.sub, lineHeight: 1 }}>{String(i + 1).padStart(2, "0")}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 66, fontWeight: 700, letterSpacing: "-0.035em", color: th.ink, lineHeight: 1.05, whiteSpace: "nowrap" }}>
                <span
                  style={
                    top
                      ? {
                          backgroundImage: `linear-gradient(${th.accentSoft}, ${th.accentSoft})`,
                          backgroundRepeat: "no-repeat",
                          backgroundSize: `${hl}% 100%`,
                          padding: "0 12px",
                          margin: "0 -12px",
                        }
                      : undefined
                  }
                >
                  {r.title}
                </span>
              </div>
              <div style={{ marginTop: 10, fontSize: 24, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: th.sub }}>{r.source}</div>
              <div style={{ marginTop: 14, height: 4, width: 1300 * r.score * line, background: top ? th.accent : th.line }} />
            </div>
            <div style={{ width: 170, textAlign: "right", fontSize: 50, fontWeight: 800, letterSpacing: "-0.03em", color: top ? th.accent : th.ink }}>{r.score.toFixed(2)}</div>
          </div>
        );
      })}
    </div>
  );
}

