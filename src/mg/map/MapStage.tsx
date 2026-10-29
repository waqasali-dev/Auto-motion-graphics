import { createContext, useContext, useMemo, type CSSProperties, type ReactNode } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import {
  MAP_WIDTH,
  MAP_HEIGHT,
  WORLD_VECTOR_PATHS,
  REGION_PRESETS,
  resolveLocation,
  type GeoPoint,
} from "./geoData";

interface MapContextValue {
  project: (target: string | [number, number]) => GeoPoint;
  frame: number;
  theme: "dark" | "light";
  activeHighlights: Set<string>;
}

export const MapContext = createContext<MapContextValue>({
  project: resolveLocation,
  frame: 0,
  theme: "dark",
  activeHighlights: new Set(),
});

export function useMap() {
  return useContext(MapContext);
}

export interface MapCameraOptions {
  center?: string | [number, number];
  zoom?: number;
  fit?: (string | [number, number])[];
  trackRoute?: {
    from: string | [number, number];
    to: string | [number, number];
    progress: number; // 0 to 1
  };
  startZoom?: number;
  midZoom?: number;
  endZoom?: number;
}

export interface MapStageProps {
  children?: ReactNode;
  region?: keyof typeof REGION_PRESETS | string;
  camera?: MapCameraOptions;
  center?: string | [number, number];
  zoom?: number;
  theme?: "dark" | "light";
  showGraticule?: boolean;
  style?: CSSProperties;
}

export function MapStage({
  children,
  region = "world",
  camera,
  center,
  zoom,
  theme = "dark",
  showGraticule = true,
  style,
}: MapStageProps) {
  const frame = useCurrentFrame();
  const { width = 1920, height = 1080 } = useVideoConfig();

  // Determine base camera position from preset or props
  const preset = REGION_PRESETS[region] || REGION_PRESETS.world;

  // Calculate dynamic camera center and zoom
  const { camX, camY, camZoom } = useMemo(() => {
    let targetX = MAP_WIDTH / 2;
    let targetY = MAP_HEIGHT / 2;
    let targetZoom = zoom ?? preset.zoom;

    if (center) {
      const pt = resolveLocation(center);
      targetX = pt.x;
      targetY = pt.y;
    } else if (preset.center) {
      const pt = resolveLocation(preset.center);
      targetX = pt.x;
      targetY = pt.y;
    }

    // Dynamic Route Tracking Camera
    if (camera?.trackRoute) {
      const fromPt = resolveLocation(camera.trackRoute.from);
      const toPt = resolveLocation(camera.trackRoute.to);
      const p = Math.max(0, Math.min(1, camera.trackRoute.progress));

      // Interpolate center position following the route
      targetX = fromPt.x + (toPt.x - fromPt.x) * p;
      // Slight parabolic arc in Y for flight curvature
      const arcDip = Math.sin(p * Math.PI) * 40;
      targetY = fromPt.y + (toPt.y - fromPt.y) * p - arcDip;

      // Parabolic zoom: tight at start -> wider in mid-flight -> tight at arrival
      const startZ = camera.startZoom ?? 2.2;
      const midZ = camera.midZoom ?? 1.4;
      const endZ = camera.endZoom ?? 2.0;

      if (p < 0.5) {
        targetZoom = interpolate(p, [0, 0.5], [startZ, midZ]);
      } else {
        targetZoom = interpolate(p, [0.5, 1], [midZ, endZ]);
      }
    } else if (camera?.fit && camera.fit.length >= 2) {
      // Fit multiple points in bounding box
      const pts = camera.fit.map(resolveLocation);
      const minX = Math.min(...pts.map((p) => p.x));
      const maxX = Math.max(...pts.map((p) => p.x));
      const minY = Math.min(...pts.map((p) => p.y));
      const maxY = Math.max(...pts.map((p) => p.y));

      targetX = (minX + maxX) / 2;
      targetY = (minY + maxY) / 2;

      const spanX = Math.max(200, maxX - minX);
      const spanY = Math.max(150, maxY - minY);
      // Fit within ~70% of viewport
      const fitZoomX = (MAP_WIDTH * 0.7) / spanX;
      const fitZoomY = (MAP_HEIGHT * 0.7) / spanY;
      targetZoom = Math.max(1.0, Math.min(2.8, Math.min(fitZoomX, fitZoomY)));
    } else if (camera?.center) {
      const pt = resolveLocation(camera.center);
      targetX = pt.x;
      targetY = pt.y;
      if (camera.zoom) targetZoom = camera.zoom;
    }

    // Clamp camera zoom to safe limits
    const safeZoom = Math.max(0.9, Math.min(3.5, targetZoom));
    return { camX: targetX, camY: targetY, camZoom: safeZoom };
  }, [camera, center, zoom, preset]);

  // Compute dynamic SVG viewBox based on camera center and zoom
  const viewBoxWidth = MAP_WIDTH / camZoom;
  const viewBoxHeight = MAP_HEIGHT / camZoom;
  const viewBoxX = Math.max(0, Math.min(MAP_WIDTH - viewBoxWidth, camX - viewBoxWidth / 2));
  const viewBoxY = Math.max(0, Math.min(MAP_HEIGHT - viewBoxHeight, camY - viewBoxHeight / 2));
  const viewBox = `${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}`;

  // Theme palettes
  const isDark = theme === "dark";
  const oceanBg = isDark
    ? "radial-gradient(ellipse at 50% 50%, #081120 0%, #04070E 100%)"
    : "radial-gradient(ellipse at 50% 50%, #E8EEF5 0%, #D5DFEB 100%)";
  const landFill = isDark ? "#141F32" : "#CBD5E1";
  const landStroke = isDark ? "#233554" : "#94A3B8";
  const graticuleStroke = isDark ? "rgba(0, 102, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";

  const contextValue = useMemo(
    () => ({
      project: resolveLocation,
      frame,
      theme,
      activeHighlights: new Set<string>(),
    }),
    [frame, theme]
  );

  return (
    <MapContext.Provider value={contextValue}>
      <AbsoluteFill
        style={{
          background: oceanBg,
          overflow: "hidden",
          ...style,
        }}
      >
        <svg
          width={width}
          height={height}
          viewBox={viewBox}
          preserveAspectRatio="xMidYMid meet"
          style={{ width: "100%", height: "100%", display: "block" }}
        >
          <defs>
            {/* Soft tactical glow filter */}
            <filter id="mapGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="mapSoft" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="12" />
            </filter>
          </defs>

          {/* Graticule lines (latitude & longitude subtle grid) */}
          {showGraticule && (
            <g opacity={0.7}>
              {/* Meridians */}
              {[250, 500, 750, 1000, 1250, 1500, 1750].map((x) => (
                <line
                  key={`meridian-${x}`}
                  x1={x}
                  y1={0}
                  x2={x}
                  y2={MAP_HEIGHT}
                  stroke={graticuleStroke}
                  strokeWidth={1}
                  strokeDasharray="4 8"
                />
              ))}
              {/* Parallels */}
              {[200, 350, 500, 650, 800].map((y) => (
                <line
                  key={`parallel-${y}`}
                  x1={0}
                  y1={y}
                  x2={MAP_WIDTH}
                  y2={y}
                  stroke={graticuleStroke}
                  strokeWidth={1}
                  strokeDasharray="4 8"
                />
              ))}
            </g>
          )}

          {/* Base world landmass polygons */}
          <g id="world-landmasses">
            {Object.entries(WORLD_VECTOR_PATHS).map(([key, d]) => (
              <path
                key={key}
                d={d}
                fill={landFill}
                stroke={landStroke}
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                style={{
                  transition: "fill 0.3s ease",
                }}
              />
            ))}
          </g>

          {/* Child layer: Highlights, Routes, Pins, Beacons */}
          {children}
        </svg>
      </AbsoluteFill>
    </MapContext.Provider>
  );
}
