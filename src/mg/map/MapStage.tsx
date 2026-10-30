import { createContext, useContext, useMemo, type CSSProperties, type ReactNode } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import {
  MAP_WIDTH,
  MAP_HEIGHT,
  WORLD_LAND_PATH,
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

export interface CameraSequenceStop {
  atFrame: number;
  focus?: string | [number, number] | (string | [number, number])[];
  zoom?: number;
  transitionFrames?: number; // Duration of glide to this stop (defaults to 24)
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
  sequence?: CameraSequenceStop[];
}

export interface MapStageProps {
  children?: ReactNode;
  region?: keyof typeof REGION_PRESETS | string;
  camera?: MapCameraOptions;
  center?: string | [number, number];
  zoom?: number;
  theme?: "dark" | "light";
  showGraticule?: boolean;
  dimInactive?: boolean;
  style?: CSSProperties;
}

function resolveFocusPointAndZoom(
  focusTarget: string | [number, number] | (string | [number, number])[] | undefined,
  fallbackZoom = 2.2
): { x: number; y: number; zoom: number } {
  if (!focusTarget || focusTarget === "world") {
    return { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2, zoom: 1.0 };
  }

  // Multi-point / region bounding box fit
  if (Array.isArray(focusTarget) && (focusTarget.length > 2 || typeof focusTarget[0] === "string" || Array.isArray(focusTarget[0]))) {
    const list = focusTarget as (string | [number, number])[];
    const pts = list.map(resolveLocation);
    const minX = Math.min(...pts.map((p) => p.x));
    const maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));
    const spanX = Math.max(180, maxX - minX);
    const spanY = Math.max(140, maxY - minY);
    const fitZoom = Math.max(1.1, Math.min(2.8, Math.min((MAP_WIDTH * 0.72) / spanX, (MAP_HEIGHT * 0.72) / spanY)));
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom: fitZoom };
  }

  // Single location
  const pt = resolveLocation(focusTarget as string | [number, number]);
  return { x: pt.x, y: pt.y, zoom: fallbackZoom };
}

export function MapStage({
  children,
  region = "world",
  camera,
  center,
  zoom,
  theme = "dark",
  showGraticule = true,
  dimInactive = false,
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

    // 1. Dynamic Camera Sequence (Multi-Stop Narrative Choreography)
    if (camera?.sequence && camera.sequence.length > 0) {
      const seq = [...camera.sequence].sort((a, b) => a.atFrame - b.atFrame);

      // Find the active segment
      let curIdx = 0;
      for (let i = 0; i < seq.length; i++) {
        if (frame >= seq[i].atFrame) {
          curIdx = i;
        } else {
          break;
        }
      }

      const curStop = seq[curIdx];
      const curResolved = resolveFocusPointAndZoom(curStop.focus, curStop.zoom ?? 2.2);

      if (curIdx < seq.length - 1) {
        const nextStop = seq[curIdx + 1];
        const transitionDuration = nextStop.transitionFrames ?? 24;
        const transitionStart = nextStop.atFrame;

        if (frame >= transitionStart) {
          // Transitioning to nextStop
          const nextResolved = resolveFocusPointAndZoom(nextStop.focus, nextStop.zoom ?? 2.2);
          const t = Math.min(1, Math.max(0, (frame - transitionStart) / transitionDuration));
          // Cubic smoothstep easing
          const easeT = t * t * (3 - 2 * t);

          targetX = curResolved.x + (nextResolved.x - curResolved.x) * easeT;
          targetY = curResolved.y + (nextResolved.y - curResolved.y) * easeT;
          targetZoom = curResolved.zoom + (nextResolved.zoom - curResolved.zoom) * easeT;
        } else {
          // Stable at curStop
          targetX = curResolved.x;
          targetY = curResolved.y;
          targetZoom = curResolved.zoom;
        }
      } else {
        // Last stop
        targetX = curResolved.x;
        targetY = curResolved.y;
        targetZoom = curResolved.zoom;
      }
    }
    // 2. Dynamic Route Tracking Camera
    else if (camera?.trackRoute) {
      const fromPt = resolveLocation(camera.trackRoute.from);
      const toPt = resolveLocation(camera.trackRoute.to);
      const p = Math.max(0, Math.min(1, camera.trackRoute.progress));

      targetX = fromPt.x + (toPt.x - fromPt.x) * p;
      const arcDip = Math.sin(p * Math.PI) * 40;
      targetY = fromPt.y + (toPt.y - fromPt.y) * p - arcDip;

      const startZ = camera.startZoom ?? 2.2;
      const midZ = camera.midZoom ?? 1.4;
      const endZ = camera.endZoom ?? 2.0;

      if (p < 0.5) {
        targetZoom = interpolate(p, [0, 0.5], [startZ, midZ]);
      } else {
        targetZoom = interpolate(p, [0.5, 1], [midZ, endZ]);
      }
    }
    // 3. Static Bounding Box Fit
    else if (camera?.fit && camera.fit.length >= 2) {
      const resolved = resolveFocusPointAndZoom(camera.fit);
      targetX = resolved.x;
      targetY = resolved.y;
      targetZoom = resolved.zoom;
    } else if (camera?.center) {
      const pt = resolveLocation(camera.center);
      targetX = pt.x;
      targetY = pt.y;
      if (camera.zoom) targetZoom = camera.zoom;
    }

    // Clamp camera zoom to safe limits
    const safeZoom = Math.max(0.9, Math.min(3.5, targetZoom));
    return { camX: targetX, camY: targetY, camZoom: safeZoom };
  }, [camera, center, zoom, preset, frame]);

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

          {/* Base authentic world landmass polygons (Natural Earth 110m) */}
          <g id="world-landmasses" opacity={dimInactive ? 0.22 : 1}>
            <path
              d={WORLD_LAND_PATH}
              fill={landFill}
              stroke={landStroke}
              strokeWidth={1.2}
              vectorEffect="non-scaling-stroke"
            />
          </g>

          {/* Child layer: Highlights, Routes, Pins, Beacons */}
          {children}
        </svg>
      </AbsoluteFill>
    </MapContext.Provider>
  );
}
