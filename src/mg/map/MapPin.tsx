import { useMemo } from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { resolveLocation } from "./geoData";

export interface MapPinProps {
  location: string | [number, number];
  label?: string;
  sublabel?: string;
  frameAt?: number;
  color?: string;
  pulse?: boolean;
}

export function MapPin({
  location,
  label,
  sublabel,
  frameAt = 0,
  color = "#0066FF",
  pulse = true,
}: MapPinProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const pt = useMemo(() => resolveLocation(location), [location]);
  const activeFrame = Math.max(0, frame - frameAt);

  // Entrance spring
  const enterSpring = spring({
    frame: activeFrame,
    fps,
    config: { damping: 14, stiffness: 180 },
  });

  // Continuous sonar ripple
  const pulsePhase = (activeFrame * 0.05) % 1;
  const pulseR = 8 + pulsePhase * 28;
  const pulseOpacity = (1 - pulsePhase) * 0.7;

  if (activeFrame <= 0) return null;

  return (
    <g transform={`translate(${pt.x}, ${pt.y})`} style={{ pointerEvents: "none" }}>
      {/* Sonar Radar Rings */}
      {pulse && (
        <>
          <circle
            r={pulseR}
            fill="none"
            stroke={color}
            strokeWidth={2}
            opacity={pulseOpacity}
            vectorEffect="non-scaling-stroke"
          />
          <circle
            r={Math.max(6, pulseR * 0.6)}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            opacity={pulseOpacity * 0.8}
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}

      {/* Main Anchor Pin */}
      <g transform={`scale(${enterSpring})`}>
        {/* Glow halo */}
        <circle r={14} fill={color} opacity={0.2} filter="url(#mapGlow)" />
        {/* Outer ring */}
        <circle r={8} fill={color} stroke="#FFFFFF" strokeWidth={2.5} />
        {/* Core center dot */}
        <circle r={3} fill="#FFFFFF" />

        {/* HUD Callout Label Badge */}
        {label && (
          <g transform="translate(18, -26)">
            {/* Callout connecting angled indicator line */}
            <line
              x1={-18}
              y1={26}
              x2={-2}
              y2={10}
              stroke={color}
              strokeWidth={1.5}
              opacity={0.8}
              vectorEffect="non-scaling-stroke"
            />
            {/* Glassmorphic label container */}
            <rect
              x={0}
              y={-4}
              width={Math.max(90, label.length * 10 + 24)}
              height={sublabel ? 38 : 26}
              rx={6}
              ry={6}
              fill="rgba(15, 23, 42, 0.88)"
              stroke={color}
              strokeWidth={1.2}
              filter="url(#mapGlow)"
            />
            {/* Label text */}
            <text
              x={12}
              y={14}
              fill="#FFFFFF"
              fontSize={13}
              fontWeight={700}
              letterSpacing="0.06em"
              fontFamily="system-ui, -apple-system, sans-serif"
            >
              {label.toUpperCase()}
            </text>
            {sublabel && (
              <text
                x={12}
                y={28}
                fill="rgba(255, 255, 255, 0.65)"
                fontSize={10}
                fontWeight={500}
                fontFamily="system-ui, -apple-system, sans-serif"
              >
                {sublabel}
              </text>
            )}
          </g>
        )}
      </g>
    </g>
  );
}

// Alias for city spot
export const MapCity = MapPin;
