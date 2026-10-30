import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { resolveCountryPath } from "./geoData";

export interface MapHighlightProps {
  country: string | string[]; // Country name, ISO code, or region ("Canada", "CA", "South America", ["ID", "AU"])
  color?: string;
  fillOpacity?: number;
  strokeWidth?: number;
  frameAt?: number;
  active?: boolean;
}

export function MapHighlight({
  country = "",
  color = "#0066FF",
  fillOpacity = 0.35,
  strokeWidth = 2.5,
  frameAt = 0,
  active = true,
}: MapHighlightProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (!country || !active) return null;

  // Resolve country or array of countries to vector path strings
  const targets = Array.isArray(country) ? country : [country];
  const paths: string[] = [];

  targets.forEach((target) => {
    const path = resolveCountryPath(target);
    if (path) paths.push(path);
  });

  if (paths.length === 0) return null;

  const activeFrame = Math.max(0, frame - frameAt);
  const p = active
    ? spring({
        frame: activeFrame,
        fps,
        config: { damping: 16, stiffness: 140 },
      })
    : 0;

  if (activeFrame <= 0) return null;

  return (
    <g className="map-highlight" style={{ pointerEvents: "none" }}>
      {paths.map((pathData, idx) => (
        <g key={`hl-path-${idx}`}>
          {/* Country Glowing Area Fill */}
          <path
            d={pathData}
            fill={color}
            opacity={fillOpacity * p}
            vectorEffect="non-scaling-stroke"
          />

          {/* Country Glowing Border Accent */}
          <path
            d={pathData}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            opacity={p}
            filter="url(#mapGlow)"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      ))}
    </g>
  );
}
