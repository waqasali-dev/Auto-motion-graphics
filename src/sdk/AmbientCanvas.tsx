// /src/sdk/AmbientCanvas.tsx
// Persistent background layer — dot-grids, concentric rings, soft gradient wash.
// The canvas runs its own 60fps paint loop; mounting it never restarts per frame.

import { useEffect, useRef } from "react";
import { tokens, type ThemeMode } from "./primitives";

export function AmbientCanvas({
  mode = "dark",
  variant = "rings",
  frame = 0,
}: {
  mode?: ThemeMode;
  variant?: "rings" | "dots" | "grid" | "wash";
  frame?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef(frame);
  phaseRef.current = frame;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let raf = 0;
    let tick = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) {
        raf = requestAnimationFrame(draw);
        return;
      }
      tick += 1;

      // Background wash
      const grad = ctx.createLinearGradient(0, 0, w, h);
      if (mode === "dark") {
        grad.addColorStop(0, tokens.darkBg);
        grad.addColorStop(1, tokens.darkBg2);
      } else {
        grad.addColorStop(0, "#F4F6F9");
        grad.addColorStop(1, "#E8ECF3");
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      const stroke = mode === "dark" ? "rgba(229,234,242,0.06)" : "rgba(17,24,39,0.07)";
      const accent = tokens.electricBlue;

      if (variant === "dots") {
        const step = 28;
        ctx.fillStyle = stroke;
        for (let y = step / 2; y < h; y += step) {
          for (let x = step / 2; x < w; x += step) {
            const jitter = Math.sin((x + y) * 0.01 + tick * 0.03) * 0.5 + 0.5;
            ctx.globalAlpha = 0.35 + jitter * 0.45;
            ctx.fillRect(x, y, 1.2, 1.2);
          }
        }
        ctx.globalAlpha = 1;
      } else if (variant === "grid") {
        const step = 40;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x < w; x += step) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
        }
        for (let y = 0; y < h; y += step) {
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
        }
        ctx.stroke();
      } else if (variant === "rings") {
        const cx = w * 0.5;
        const cy = h * 0.55;
        const baseR = Math.min(w, h) * 0.1;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        for (let i = 0; i < 6; i++) {
          const r = baseR + i * (Math.min(w, h) * 0.08);
          const pulse = 1 + Math.sin(tick * 0.015 + i) * 0.02;
          ctx.beginPath();
          ctx.arc(cx, cy, r * pulse, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        const r2 = baseR + 4 * (Math.min(w, h) * 0.08);
        const ang = (tick * 0.006) % (Math.PI * 2);
        ctx.arc(cx, cy, r2, ang, ang + 0.25);
        ctx.stroke();
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
    // `frame` is intentionally excluded: the canvas owns its paint loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, variant]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ display: "block" }}
    />
  );
}
