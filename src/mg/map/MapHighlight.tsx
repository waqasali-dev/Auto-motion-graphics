import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { WORLD_VECTOR_PATHS, COUNTRY_ISO_MAP } from "./geoData";

export interface MapHighlightProps {
  country: string; // ISO-2 code like "GB", "US", "CN" or region like "uk", "northAmerica"
  color?: string;
  fillOpacity?: number;
  strokeWidth?: number;
  frameAt?: number;
  active?: boolean;
}

export function MapHighlight({
  country,
  color = "#0066FF",
  fillOpacity = 0.35,
  strokeWidth = 2.5,
  frameAt = 0,
  active = true,
}: MapHighlightProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Resolve country code to vector path
  const normalizedKey = country.toUpperCase();
  const mapping = COUNTRY_ISO_MAP[normalizedKey];
  const pathKey = mapping ? mapping.pathKey : country;
  const pathData = WORLD_VECTOR_PATHS[pathKey];

  const activeFrame = Math.max(0, frame - frameAt);
  const p = active
    ? spring({
        frame: activeFrame,
        fps,
        config: { damping: 16, stiffness: 140 },
      })
    : 0;

  if (!pathData || !active || activeFrame <= 0) return null;

  return (
    <g className="map-highlight" style={{ pointerEvents: "none" }}>
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
  );
}
