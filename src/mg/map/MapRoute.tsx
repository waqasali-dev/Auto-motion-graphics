import { useMemo } from "react";
import { resolveLocation } from "./geoData";

export interface MapRouteProps {
  from: string | [number, number];
  to: string | [number, number];
  progress?: number; // 0 to 1
  color?: string;
  strokeWidth?: number;
  arcHeight?: number; // Curve altitude (defaults to distance-based)
  dashed?: boolean;
  showBeacon?: boolean;
  beaconSize?: number;
}

export function MapRoute({
  from,
  to,
  progress = 1,
  color = "#0066FF",
  strokeWidth = 4,
  arcHeight,
  dashed = false,
  showBeacon = true,
  beaconSize = 8,
}: MapRouteProps) {
  const p = Math.max(0, Math.min(1, progress));
  const fromPt = useMemo(() => resolveLocation(from || [-74, 40]), [from]);
  const toPt = useMemo(() => resolveLocation(to || [0, 51]), [to]);

  // Calculate distance and parabolic control point
  const dx = toPt.x - fromPt.x;
  const dy = toPt.y - fromPt.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Normal vector perpendicular to flight direction
  const defaultAltitude = Math.min(180, Math.max(40, dist * 0.18));
  const altitude = arcHeight ?? defaultAltitude;

  // Midpoint with upward arc
  const midX = (fromPt.x + toPt.x) / 2;
  const midY = (fromPt.y + toPt.y) / 2 - altitude;

  // Quadratic bezier path
  const fullPathD = `M ${fromPt.x},${fromPt.y} Q ${midX},${midY} ${toPt.x},${toPt.y}`;

  // Current point along quadratic bezier curve: B(t) = (1-t)^2 P0 + 2(1-t)t P1 + t^2 P2
  const t = p;
  const currentX = Math.pow(1 - t, 2) * fromPt.x + 2 * (1 - t) * t * midX + Math.pow(t, 2) * toPt.x;
  const currentY = Math.pow(1 - t, 2) * fromPt.y + 2 * (1 - t) * t * midY + Math.pow(t, 2) * toPt.y;

  return (
    <g className="map-route" style={{ pointerEvents: "none" }}>
      {/* Background Soft Glow Stroke */}
      <path
        d={fullPathD}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth * 3.5}
        opacity={0.3 * Math.min(1, p * 2)}
        filter="url(#mapSoft)"
        pathLength={1}
        strokeDasharray="1 2"
        strokeDashoffset={1 - p}
        vectorEffect="non-scaling-stroke"
      />

      {/* Main Crisp Route Line */}
      <path
        d={fullPathD}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray={dashed ? "0.04 0.04" : "1 2"}
        strokeDashoffset={1 - p}
        vectorEffect="non-scaling-stroke"
      />

      {/* In-Flight Traveling Beacon / Head */}
      {showBeacon && p > 0.02 && p < 0.99 && (
        <g transform={`translate(${currentX}, ${currentY})`}>
          {/* Radar ripple */}
          <circle r={beaconSize * 2.2} fill={color} opacity={0.25} />
          {/* Core beacon dot */}
          <circle r={beaconSize} fill="#FFFFFF" stroke={color} strokeWidth={2.5} />
        </g>
      )}
    </g>
  );
}
