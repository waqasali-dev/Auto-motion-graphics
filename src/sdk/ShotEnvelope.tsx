// /src/sdk/ShotEnvelope.tsx
// Auto 10-frame entry / 12-frame exit blur-fade wrapper.
// Every worker-generated component must wrap its return in this.

import type { ReactNode } from "react";
import { safeInterpolate, easeOutCubic } from "./primitives";

const easeInCubic = (t: number) => t * t * t;

export function ShotEnvelope({
  currentFrame,
  durationInFrames,
  children,
}: {
  currentFrame: number;
  durationInFrames: number;
  children: ReactNode;
}) {
  const ENTRY_FRAMES = 10;
  const EXIT_FRAMES = 12;
  const exitStart = durationInFrames - EXIT_FRAMES;

  let opacity = 1;
  let blur = 0;
  let y = 0;

  if (currentFrame < ENTRY_FRAMES) {
    const t = safeInterpolate(currentFrame, [0, ENTRY_FRAMES], [0, 1], easeOutCubic);
    opacity = t;
    blur = (1 - t) * 10;
    y = (1 - t) * 8;
  } else if (currentFrame >= exitStart) {
    const t = safeInterpolate(currentFrame, [exitStart, durationInFrames], [0, 1], easeInCubic);
    opacity = 1 - t;
    blur = t * 10;
    y = -t * 6;
  }

  return (
    <div
      style={{
        opacity,
        filter: `blur(${blur}px)`,
        transform: `translateY(${y}px)`,
        willChange: "opacity, filter, transform",
      }}
      className="w-full h-full"
    >
      {children}
    </div>
  );
}

// (easeInCubic is used internally for the exit curve)
