// src/mg/scenes/editorial.tsx
// Editorial and photographic scenes, composed in 1920x1080 comp pixels.

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
  wiggle,
  mb,
  rand,
  Rise,
  Words,
  Odometer,
  Label,
  trim,
  circlePath,
  splitFigure,
  splitHeadline,
} from "../core";

// ──────────────────────────────────────────────────────────────────────────────
// KineticHero — words slam in, a capsule expands from a dot, digits roll
// ──────────────────────────────────────────────────────────────────────────────

function Capsule({ f, at, num, unit, out }: { f: number; at: number; num: string; unit: string; out: number }) {
  const size = 112;
  const pop = kf(f, [[at, 0], [at + 12, 1, E.back]]);
  const full = 1.2 + num.length * 0.66 + (unit ? unit.length * 0.52 + 0.4 : 0) + 0.7;
  const w = kf(f, [[at + 6, 1.2], [at + 32, full, E.out]]);
  const exit = kf(f, [[out, 0], [out + 18, -170, E.in]]);
  return (
    <div
      style={{
        fontSize: size,
        height: "1.2em",
        width: `${w}em`,
        flex: "0 0 auto",
        borderRadius: 999,
        background: COLOR.blue,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        transform: `translateY(${exit}%) scale(${pop}) rotate(-2deg)`,
        boxShadow: "0 40px 90px rgba(0,102,255,0.35)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20, color: "#fff", whiteSpace: "nowrap" }}>
        <Odometer value={num} f={f} at={at + 12} size={size * 0.84} color="#fff" />
        {unit && (
          <Rise f={f} at={at + 24} h={size}>
            <span style={{ fontSize: size * 0.72, fontWeight: 700, letterSpacing: "-0.03em" }}>{unit}</span>
          </Rise>
        )}
      </div>
    </div>
  );
}

export function KineticHero({ frame: f, duration, content }: SceneProps) {
  const b = content?.beat;
  const line = b?.headline ?? "this 40-second spot took just";
  const value = b?.figures?.[0]?.value ?? "20 mins";
  const [num, unit] = splitFigure(value);
  const words = line.split(" ").filter(Boolean);
  const pillAt = 8 + words.length * 5 + 6;
  const out = duration - 24;
  const zoom = kf(f, [[0, 1.04], [pillAt + 20, 1], [duration, 1.16, E.soft]]);
  const ghostX = kf(f, [[0, 260], [duration, -180, E.linear]]);

  return (
    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(160deg,#CBE1F7 0%,#E1EDF9 50%,#F4F7FB 100%)" }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(55% 60% at 18% 8%, rgba(255,255,255,0.9), transparent 70%)" }} />
      <div
        style={{
          position: "absolute",
          right: -140,
          top: 10,
          fontSize: 1100,
          fontWeight: 800,
          lineHeight: 0.85,
          letterSpacing: "-0.06em",
          color: "transparent",
          WebkitTextStroke: "3px rgba(0,102,255,0.12)",
          transform: `translateX(${ghostX}px)`,
          whiteSpace: "nowrap",
        }}
      >
        {num}
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: `scale(${zoom})`,
          transformOrigin: "70% 52%",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            justifyContent: "center",
            columnGap: 28,
            rowGap: 14,
            maxWidth: 1640,
            fontSize: 112,
            fontWeight: 600,
            letterSpacing: "-0.04em",
            color: COLOR.ink,
          }}
        >
          {words.map((w, i) => (
            <Rise key={`${w}-${i}`} f={f} at={8 + i * 5} h={112} out={out + i * 2}>
              {w}
            </Rise>
          ))}
          <Capsule f={f} at={pillAt} num={num} unit={unit} out={out + words.length * 2} />
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// ScaleTradeoff — a giant numeral filled with the product photograph
// ──────────────────────────────────────────────────────────────────────────────

export function ScaleTradeoff({ frame: f, duration, content }: SceneProps) {
  const b = content?.beat;
  const figs = b?.figures?.length ? b.figures : [{ value: "40", label: "sec" }];
  const [n1, u1raw] = splitFigure(figs[0].value);
  const u1 = u1raw || figs[0].label;
  const second = figs[1];
  const [n2, u2raw] = second ? splitFigure(second.value) : ["", ""];
  const u2 = u2raw || second?.label || "";
  const swapAt = second ? Math.round(duration * 0.46) : Number.POSITIVE_INFINITY;
  const img = b?.image ?? IMG.hero;
  const word = second ? "" : b?.kicker ?? "AD";

  const reveal = kf(f, [[4, 0], [32, 100, E.inOut]]);
  const pan = kf(f, [[0, 15], [duration, 85, E.linear]]);
  const push = kf(f, [[0, 1], [duration, 1.06, E.linear]]);
  const g1 = (fr: number) => kf(fr, [[swapAt, 0], [swapAt + 22, -1150, E.in]]);
  const g2 = (fr: number) => kf(fr, [[swapAt + 6, 1150], [swapAt + 34, 0, E.out]]);
  const strike = second ? kf(f, [[swapAt - 42, 0], [swapAt - 18, 1, E.inOut]]) : 0;

  const numStyle = { fontSize: 620, fontWeight: 800, letterSpacing: "-0.07em", lineHeight: 0.8, whiteSpace: "nowrap" as const };

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "linear-gradient(135deg,#F2EFFC 0%,#E9E5F7 55%,#FAF9FF 100%)" }}>
      <div
        style={{
          position: "absolute",
          right: -320,
          top: -320,
          width: 1150,
          height: 1150,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(0,102,255,0.18), transparent 65%)",
          transform: `translate(${wiggle(f, 0.15, 40, 1)}px, ${wiggle(f, 0.15, 40, 2)}px)`,
        }}
      />
      <div style={{ position: "absolute", inset: 0, transform: `scale(${push})`, transformOrigin: "25% 50%" }}>
        <div style={{ position: "absolute", left: 150, top: 160, transform: `translateY(${g1(f)}px)`, filter: mb(0, g1(f) - g1(f - 1)) }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 34 }}>
            <div style={{ position: "relative" }}>
              <div style={{ ...numStyle, position: "absolute", left: 24, top: 24, color: COLOR.blue, opacity: 0.16, clipPath: `inset(0 ${100 - reveal}% 0 0)` }}>{n1}</div>
              <div
                style={{
                  ...numStyle,
                  backgroundImage: `url(${img})`,
                  backgroundSize: "cover",
                  backgroundPosition: `${pan}% 50%`,
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                  WebkitTextFillColor: "transparent",
                  clipPath: `inset(0 ${100 - reveal}% 0 0)`,
                }}
              >
                {n1}
              </div>
              {second && (
                <div
                  style={{
                    position: "absolute",
                    left: "-4%",
                    top: "50%",
                    height: 26,
                    width: `${strike * 108}%`,
                    background: COLOR.coral,
                    transform: "rotate(-5deg)",
                    transformOrigin: "left center",
                  }}
                />
              )}
            </div>
            <div style={{ paddingBottom: 46 }}>
              <Rise f={f} at={22} h={190}>
                <span style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 190, color: COLOR.ink }}>{u1}</span>
              </Rise>
            </div>
          </div>
          {word && (
            <div style={{ marginTop: 14 }}>
              <Words text={word} f={f} at={32} size={220} weight={800} color={COLOR.ink} />
            </div>
          )}
        </div>

        {second && (
          <div style={{ position: "absolute", left: 150, top: 160, transform: `translateY(${g2(f)}px)`, filter: mb(0, g2(f) - g2(f - 1)) }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 34 }}>
              <div style={{ ...numStyle, color: COLOR.blue }}>{n2}</div>
              <div style={{ paddingBottom: 46, fontFamily: SERIF, fontStyle: "italic", fontSize: 190, color: COLOR.ink }}>{u2}</div>
            </div>
          </div>
        )}

        <div style={{ position: "absolute", left: 158, bottom: 110 }}>
          <Label text={b?.headline ?? "one transcript · eight distinct shots"} f={f} at={44} color={COLOR.ink} lineColor={COLOR.blue} size={26} />
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SplitComparison — a seam draws, two photographs wipe out from it
// ──────────────────────────────────────────────────────────────────────────────

export function SplitComparison({ frame: f, duration, content }: SceneProps) {
  const b = content?.beat;
  const figs =
    b?.figures && b.figures.length >= 2
      ? b.figures
      : [
          { value: "3 days", label: "manual timeline edits" },
          { value: "20 min", label: "frame-locked render" },
        ];
  const seam = kf(f, [[2, 0], [22, 1, E.inOut]]);
  const lw = kf(f, [[12, 0], [40, 1, E.inOut]]);
  const rw = kf(f, [[18, 0], [46, 1, E.inOut]]);
  const strike = kf(f, [[100, 0], [120, 1, E.inOut]]);
  const badge = kf(f, [[60, 0], [74, 1, E.back]]);

  const half = (side: "left" | "right", img: string, t: number, fig: { value: string; label: string }, at: number, label: string) => {
    const drift = kf(f, [[0, side === "left" ? -30 : 30], [duration, side === "left" ? 30 : -30, E.linear]]);
    return (
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: side === "left" ? 0 : W / 2,
          width: W / 2,
          overflow: "hidden",
          clipPath: side === "left" ? `inset(0 0 0 ${(1 - t) * 100}%)` : `inset(0 ${(1 - t) * 100}% 0 0)`,
        }}
      >
        <img
          src={img}
          alt=""
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(1.16) translateX(${drift}px)`,
            filter: side === "left" ? "grayscale(0.75) brightness(0.5)" : "brightness(0.78) saturate(1.1)",
          }}
        />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(4,6,12,0.35) 0%, transparent 35%, rgba(4,6,12,0.85) 100%)" }} />
        <div style={{ position: "absolute", left: 96, bottom: 110 }}>
          <Label text={label} f={f} at={at} color={side === "left" ? "#FFB8B2" : "#A9C8FF"} />
          <div style={{ marginTop: 22, position: "relative", display: "inline-block" }}>
            <Words text={fig.value} f={f} at={at + 6} size={190} weight={800} color="#fff" />
            {side === "left" && (
              <div
                style={{
                  position: "absolute",
                  left: -12,
                  top: "50%",
                  height: 18,
                  width: `${strike * 108}%`,
                  background: COLOR.coral,
                  transform: "rotate(-3deg)",
                  transformOrigin: "left center",
                }}
              />
            )}
          </div>
          <div style={{ marginTop: 16 }}>
            <Rise f={f} at={at + 14} h={34}>
              <span style={{ fontSize: 34, fontWeight: 500, color: "rgba(255,255,255,0.78)" }}>{fig.label}</span>
            </Rise>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ position: "absolute", inset: 0, background: "#05070D" }}>
      {half("left", IMG.flatlay, lw, figs[0], 36, "Before")}
      {half("right", b?.image ?? IMG.wrist, rw, figs[1], 52, "After")}
      <div
        style={{
          position: "absolute",
          left: W / 2 - 2,
          top: H / 2,
          width: 4,
          height: seam * H,
          transform: "translateY(-50%)",
          background: "#fff",
          boxShadow: "0 0 40px rgba(255,255,255,0.6)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: W / 2,
          top: H / 2 - 120,
          width: 150,
          height: 150,
          borderRadius: "50%",
          background: "#fff",
          color: COLOR.ink,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 76,
          fontWeight: 800,
          transform: `translate(-50%, 0) scale(${badge})`,
          boxShadow: "0 30px 70px rgba(0,0,0,0.45)",
        }}
      >
        →
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// DeviceMockup — a 3D product carousel with a camera dolly in
// ──────────────────────────────────────────────────────────────────────────────

export function DeviceMockup({ frame: f, duration, content }: SceneProps) {
  const b = content?.beat;
  const imgs = [IMG.wrist, IMG.dark, IMG.hero, IMG.flatlay, IMG.wrist, IMG.dark];
  const step = 360 / imgs.length;
  const rot = kf(f, [[0, 80], [duration, -50, E.soft]]);
  const dolly = kf(f, [[0, -1500], [70, -360, E.out]]);

  return (
    <div style={{ position: "absolute", inset: 0, background: "radial-gradient(60% 70% at 50% 58%, #261B60 0%, #0B0A20 55%, #040409 100%)" }}>
      <div style={{ position: "absolute", left: W / 2 - 700, top: 760, width: 1400, height: 260, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(120,100,255,0.35), transparent)" }} />
      <div style={{ position: "absolute", inset: 0, perspective: 1700, perspectiveOrigin: "50% 42%" }}>
        <div
          style={{
            position: "absolute",
            left: W / 2,
            top: H / 2 - 50,
            width: 0,
            height: 0,
            transformStyle: "preserve-3d",
            transform: `translateZ(${dolly}px) rotateX(-4deg) rotateY(${rot}deg)`,
          }}
        >
          {imgs.map((src, i) => {
            const a = i * step;
            const d = ((((a + rot) % 360) + 540) % 360) - 180;
            const front = 1 - Math.min(1, Math.abs(d) / 90);
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: -250,
                  top: -360,
                  width: 500,
                  height: 720,
                  transform: `rotateY(${a}deg) translateZ(820px)`,
                  backfaceVisibility: "hidden",
                  borderRadius: 24,
                  overflow: "hidden",
                  filter: `brightness(${0.3 + 0.7 * front}) blur(${(1 - front) * 5}px)`,
                  boxShadow: front > 0.8 ? "0 0 140px rgba(130,110,255,0.6)" : "none",
                }}
              >
                <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ position: "absolute", left: 120, bottom: 100, width: 1100 }}>
        <Label text={b?.kicker ?? "one browser tab"} f={f} at={34} color="rgba(255,255,255,0.7)" lineColor="#8F7BFF" />
        <div style={{ height: 22 }} />
        <Words text={b?.headline ?? "Every asset and every cut lives in one place."} f={f} at={42} size={78} weight={700} color="#fff" />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// DarkImpactClose — tracking-expand statement, then a logo end card
// ──────────────────────────────────────────────────────────────────────────────

export function DarkImpactClose({ frame: f, duration, content }: SceneProps) {
  const [l1, l2] = splitHeadline(content?.beat?.headline ?? "The voice leads. The frames obey.");
  const endAt = Math.max(140, duration - 100);
  const track = kf(f, [[34, 0.42], [116, -0.015, E.out]]);
  const l2o = kf(f, [[34, 0], [62, 1, E.out]]);
  const textOut = kf(f, [[endAt, 0], [endAt + 22, 1, E.in]]);
  const ring = kf(f, [[endAt + 14, 0], [endAt + 52, 1, E.inOut]]);
  const beam = 0.6 + wiggle(f, 0.4, 0.14, 3);
  const push = kf(f, [[0, 1.07], [duration, 1, E.soft]]);

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "radial-gradient(70% 95% at 50% 0%, #15224A 0%, #070B18 55%, #03050A 100%)" }}>
      <div
        style={{
          position: "absolute",
          left: W / 2 - 480,
          top: -100,
          width: 960,
          height: H + 200,
          background: `linear-gradient(180deg, rgba(95,145,255,${0.34 * beam}) 0%, transparent 75%)`,
          filter: "blur(70px)",
        }}
      />
      {Array.from({ length: 46 }).map((_, i) => {
        const speed = 0.25 + rand(i) * 0.6;
        const y = H + 20 - ((rand(i + 50) * (H + 40) + f * speed) % (H + 40));
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: rand(i + 100) * W,
              top: y,
              width: 2 + rand(i + 7) * 3,
              height: 2 + rand(i + 7) * 3,
              borderRadius: "50%",
              background: "#CFE0FF",
              opacity: 0.12 + rand(i + 9) * 0.25,
            }}
          />
        );
      })}

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          transform: `scale(${push * (1 - textOut * 0.06)})`,
          opacity: 1 - textOut,
          filter: textOut > 0 ? `blur(${textOut * 18}px)` : undefined,
        }}
      >
        <Words text={l1} f={f} at={10} stagger={5} size={150} weight={700} color="#F2F5FB" align="center" width={1700} />
        <div
          style={{
            fontFamily: SERIF,
            fontStyle: "italic",
            fontSize: 184,
            lineHeight: 1.05,
            color: "#A4BEFF",
            letterSpacing: `${track}em`,
            opacity: l2o,
            transform: `translateY(${(1 - l2o) * 50}px)`,
            whiteSpace: "nowrap",
          }}
        >
          {l2}
        </div>
      </div>

      {f >= endAt && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 34 }}>
          <svg width={240} height={240} style={{ overflow: "visible" }}>
            <path d={circlePath(120, 120, 100)} fill="none" stroke={COLOR.blue} strokeWidth={12} strokeLinecap="round" filter="url(#mgGlow)" {...trim(0, ring)} />
            <rect x={96} y={96} width={48} height={48} fill="#fff" opacity={tw(f, endAt + 40, 10)} transform={`rotate(${kf(f, [[endAt + 40, -45], [endAt + 60, 0, E.out]])} 120 120)`} />
          </svg>
          <Rise f={f} at={endAt + 40} h={84}>
            <span style={{ fontSize: 84, fontWeight: 800, letterSpacing: "-0.04em", color: "#fff" }}>frame/60</span>
          </Rise>
          <Rise f={f} at={endAt + 50} h={24}>
            <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: "0.32em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)" }}>deterministic motion from speech</span>
          </Rise>
        </div>
      )}
    </div>
  );
}
