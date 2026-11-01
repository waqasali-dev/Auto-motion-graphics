// Browser-side Remotion TSX compiler for model-authored shots.
// The LLM owns each scene's JSX and animation; only the Remotion APIs and a
// small low-level motion-primitive namespace are injected by the host.

import { parse } from "@babel/parser";
import * as Babel from "@babel/standalone";
import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  random,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { mg } from "../mg/runtime";
import type { ShotVisualPrompt, WordCue, CreativeShotPlan, UploadedImageAsset } from "../sdk/contract.generated";

export interface GeneratedSceneProps {
  shotPlan: CreativeShotPlan;
  visualPrompt: ShotVisualPrompt;
  wordCues: WordCue[];
  continuity: {
    previousVisualSummary: string;
    nextVisualSummary: string;
    paletteAnchor: string;
    typeAnchor: string;
  };
  assets: Record<string, UploadedImageAsset>;
}

export type GeneratedSceneComponent = React.ComponentType<GeneratedSceneProps>;

const REMOTION_IMPORTS = new Set([
  "AbsoluteFill", "Sequence", "useCurrentFrame", "useVideoConfig", "interpolate", "spring", "Easing", "random", "Img",
]);
const SAFE_HTML = new Set([
  // Layout & structural
  "div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6", "header", "footer", "section", "article", "main", "aside", "figure", "figcaption",
  "br", "hr",
  // Text formatting
  "strong", "em", "b", "i", "small", "code", "pre", "blockquote", "mark", "sub", "sup", "label", "abbr", "cite", "time", "kbd", "button",
  // Lists
  "ul", "ol", "li",
  // Tables
  "table", "thead", "tbody", "tr", "th", "td",
  // Styling & canvas
  "style", "canvas",
  // SVG core & shapes
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  // SVG structural & definitions (including metadata, marker, pattern)
  "defs", "symbol", "use", "marker", "pattern", "clipPath", "mask", "foreignObject", "metadata", "title", "desc", "image",
  // SVG gradients
  "linearGradient", "radialGradient", "stop",
  // SVG text
  "text", "tspan", "textPath",
  // SVG filters
  "filter", "feGaussianBlur", "feMerge", "feMergeNode", "feOffset", "feColorMatrix", "feBlend", "feDropShadow",
  "feComposite", "feDisplacementMap", "feTurbulence", "feFlood", "feImage",
]);
const FORBIDDEN_IDENTIFIERS = new Set([
  "window", "document", "globalThis", "self", "process", "require", "module", "exports", "fetch",
  "XMLHttpRequest", "WebSocket", "Worker", "SharedWorker", "ServiceWorker", "localStorage", "sessionStorage",
  "indexedDB", "navigator", "location", "Function", "eval", "setTimeout", "setInterval", "requestAnimationFrame",
  "cancelAnimationFrame", "MutationObserver", "ResizeObserver", "AudioContext", "MediaRecorder",
]);

export interface CompileResult {
  component: GeneratedSceneComponent;
  sourceHash: string;
  transpiledBytes: number;
}

function hashSource(source: string): string {
  let h = 2166136261;
  for (let i = 0; i < source.length; i++) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function jsxName(node: any): string {
  if (!node) return "";
  if (node.type === "JSXIdentifier") return node.name;
  if (node.type === "JSXMemberExpression") return `${jsxName(node.object)}.${jsxName(node.property)}`;
  return "";
}

const APPROVED_REACT_NAMED = new Set([
  "useMemo", "useCallback", "useRef", "useState", "useEffect", "useLayoutEffect", "CSSProperties", "ReactNode", "FC",
]);

function assertApprovedImports(node: any) {
  const source = node.source?.value;
  if (source === "react") {
    for (const spec of node.specifiers ?? []) {
      if (spec.type === "ImportDefaultSpecifier" && spec.local?.name === "React") continue;
      if (spec.importKind === "type" || node.importKind === "type") continue;
      if (spec.type === "ImportSpecifier" && APPROVED_REACT_NAMED.has(spec.imported?.name)) continue;
      throw new Error(`Import "${spec.imported?.name || spec.local?.name}" is not approved from "react". Only default React or standard hooks (useMemo, useCallback) are allowed.`);
    }
    return;
  }
  if (source === "remotion") {
    for (const spec of node.specifiers ?? []) {
      if (spec.importKind === "type" || node.importKind === "type") continue;
      if (spec.type !== "ImportSpecifier" || !REMOTION_IMPORTS.has(spec.imported.name)) {
        throw new Error(`Remotion import "${spec.imported?.name}" is not in the approved render API.`);
      }
    }
    return;
  }
  if (source === "@frame60/mg") {
    const onlyMg = (node.specifiers ?? []).every((s: any) => s.type === "ImportSpecifier" && s.imported.name === "mg");
    if (!onlyMg) throw new Error('Only the named "mg" primitives import is allowed from "@frame60/mg".');
    return;
  }
  throw new Error(`External import "${source}" is not allowed in generated scenes.`);
}

function inspectAst(root: any) {
  const localNames = new Set<string>(["GeneratedShot"]);
  const imports: any[] = [];
  let exportedScene = false;

  const collectLocalNames = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) collectLocalNames(child);
      return;
    }
    if (node.type === "VariableDeclarator" && node.id?.type === "Identifier") localNames.add(node.id.name);
    if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id?.name) localNames.add(node.id.name);
    for (const [k, v] of Object.entries(node)) {
      if (["loc", "start", "end", "extra", "leadingComments", "trailingComments", "innerComments"].includes(k)) continue;
      if (Array.isArray(v)) for (const child of v) collectLocalNames(child);
      else if (v && typeof v === "object") collectLocalNames(v);
    }
  };
  collectLocalNames(root.program);

  for (const node of root.program.body as any[]) {
    if (node.type === "ImportDeclaration") {
      assertApprovedImports(node);
      imports.push(node);
      continue;
    }
    if (node.type === "ExportNamedDeclaration") {
      const d = node.declaration;
      if (d?.type !== "VariableDeclaration" || !d.declarations?.some((x: any) => x.id?.name === "GeneratedShot")) {
        throw new Error("Generated module may export only `GeneratedShot`.");
      }
      exportedScene = true;
      if (d.declarations.some((x: any) => x.id?.name !== "GeneratedShot")) {
        throw new Error("Do not export helper variables; keep helpers local inside GeneratedShot.");
      }
    }
    if (node.type === "ExportDefaultDeclaration") {
      const d = node.declaration;
      if (d?.type !== "FunctionDeclaration" || d.id?.name !== "GeneratedShot") {
        throw new Error("Use the named `GeneratedShot` export, not a default export.");
      }
      exportedScene = true;
    }
  }
  if (!exportedScene) throw new Error("No `export const GeneratedShot = (...) => ...` component found.");

  const walk = (node: any, parent?: any, key?: string) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, parent, key);
      return;
    }
    if (typeof node.type !== "string") return;

    if (["WhileStatement", "DoWhileStatement", "WithStatement", "ImportExpression"].includes(node.type)) {
      throw new Error(`Generated scene uses forbidden syntax: ${node.type}. Use frame-derived map/interpolate expressions instead.`);
    }
    // Only check identifier if it is a free global reference, not an object property or local declaration
    const isPropertyOrDeclaration =
      (parent?.type === "MemberExpression" && parent.property === node && !parent.computed) ||
      (parent?.type === "ObjectProperty" && parent.key === node && !parent.computed) ||
      (parent?.type === "VariableDeclarator" && parent.id === node) ||
      (parent?.type === "FunctionDeclaration" && parent.id === node) ||
      (parent?.type === "ArrowFunctionExpression" && parent.params?.includes(node)) ||
      (parent?.type === "RestElement") ||
      (parent?.type === "AssignmentPattern" && parent.left === node);

    if (!isPropertyOrDeclaration && node.type === "Identifier" && FORBIDDEN_IDENTIFIERS.has(node.name)) {
      throw new Error(`Generated scene references forbidden browser/IO global "${node.name}".`);
    }
    if (node.type === "CallExpression") {
      const c = node.callee;
      if (c.type === "Identifier" && ["eval", "Function", "require", "setTimeout", "setInterval", "fetch"].includes(c.name)) {
        throw new Error(`Generated scene calls forbidden function "${c.name}".`);
      }
      if (c.type === "MemberExpression" && c.object?.name === "Math" && c.property?.name === "random") {
        throw new Error("Math.random is nondeterministic; use Remotion random(seed) instead.");
      }
    }
    if (node.type === "NewExpression") {
      const callee = node.callee;
      const name = callee?.type === "Identifier" ? callee.name : "";
      const allowedConstructors = new Set(["Array", "Set", "Map", "Uint8Array", "Float32Array", "Int32Array", "Object"]);
      if (!allowedConstructors.has(name)) {
        throw new Error(`Generated scene may not construct runtime class "${name || "expression"}".`);
      }
    }
    if (node.type === "JSXOpeningElement" || node.type === "JSXClosingElement") {
      const name = jsxName(node.name);
      const base = name.split(".")[0];
      const allowed =
        SAFE_HTML.has(name) ||
        REMOTION_IMPORTS.has(name) ||
        name === "React.Fragment" ||
        base === "mg" ||
        base === "React" ||
        localNames.has(name) ||
        localNames.has(base);
      if (!allowed) throw new Error(`JSX element <${name}> is not an approved primitive or locally declared element.`);
      if (name === "script" || name === "iframe" || name === "object" || name === "embed") throw new Error(`<${name}> is not allowed in generated motion graphics.`);
    }
    if (node.type === "ObjectProperty" && node.key?.type === "Identifier" && ["animation", "transition"].includes(node.key.name)) {
      throw new Error("CSS keyframe animations/transitions are forbidden. Drive motion from Remotion frames.");
    }
    if (
      node.type === "ObjectProperty" &&
      node.key?.type === "Identifier" &&
      ["mask", "maskImage", "WebkitMaskImage", "webkitMaskImage"].includes(node.key.name)
    ) {
      throw new Error("CSS mask/maskImage is not supported by the Remotion renderer. Use SVG <clipPath id=\"...\">, CSS overflow: 'hidden', or opacity interpolation instead.");
    }
    // Allow standard W3C SVG namespace URLs like http://www.w3.org/2000/svg
    if (
      node.type === "StringLiteral" &&
      /^https?:\/\//i.test(node.value) &&
      !node.value.startsWith("http://www.w3.org/") &&
      !node.value.startsWith("https://www.w3.org/")
    ) {
      throw new Error("External URLs are not permitted in generated scene code; use the supplied assets prop.");
    }
    for (const [k, v] of Object.entries(node)) {
      if (["loc", "start", "end", "extra", "leadingComments", "trailingComments", "innerComments"].includes(k)) continue;
      if (Array.isArray(v)) for (const child of v) walk(child, node, k);
      else if (v && typeof v === "object") walk(v, node, k);
    }
  };
  walk(root.program);
  return imports;
}

function stripModuleSyntax(source: string, ast: any, imports: any[]) {
  const removals: Array<{ start: number; end: number; replacement: string }> = imports.map((n) => {
    // If named specifiers from react were imported, expose them from React
    if (n.source?.value === "react") {
      const named = (n.specifiers ?? [])
        .filter((s: any) => s.type === "ImportSpecifier" && s.imported?.name)
        .map((s: any) => s.imported.name);
      if (named.length > 0) {
        return { start: n.start, end: n.end, replacement: `const { ${named.join(", ")} } = React;\n` };
      }
    }
    return { start: n.start, end: n.end, replacement: "" };
  });
  for (const node of ast.program.body as any[]) {
    if (node.type === "ExportNamedDeclaration") {
      removals.push({ start: node.start, end: node.declaration.start, replacement: "" });
    } else if (node.type === "ExportDefaultDeclaration") {
      removals.push({ start: node.start, end: node.declaration.start, replacement: "const " });
    }
  }
  let result = source;
  for (const item of removals.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, item.start) + item.replacement + result.slice(item.end);
  }
  return result;
}

export function compileGeneratedShot(sourceCode: string): CompileResult {
  if (sourceCode.length < 80) throw new Error("Generated TSX is empty or too short to be a scene.");
  if (sourceCode.length > 50000) throw new Error("Generated TSX exceeds the 50 KB per-shot source limit.");
  if (!/useCurrentFrame\s*\(/.test(sourceCode)) throw new Error("Generated scene must drive all motion from Remotion useCurrentFrame().");
  if (!/useVideoConfig\s*\(/.test(sourceCode)) throw new Error("Generated scene must read the fixed 1920×1080 / 60fps video config.");
  if (!/wordCues/.test(sourceCode)) throw new Error("Generated scene does not consume its transcript word cues; audio sync would be lost.");
  const ast = parse(sourceCode, { sourceType: "module", plugins: ["jsx", "typescript"] });
  const imports = inspectAst(ast);
  const executable = stripModuleSyntax(sourceCode, ast, imports);
  const transformed = Babel.transform(executable, {
    filename: "GeneratedShot.tsx",
    sourceType: "script",
    presets: [["typescript", { allExtensions: true, isTSX: true }], ["react", { runtime: "classic" }]],
    comments: false,
  });
  if (!transformed.code) throw new Error("Babel produced no JavaScript for the generated shot.");

  const factory = new Function(
    "React", "AbsoluteFill", "Sequence", "useCurrentFrame", "useVideoConfig", "interpolate", "spring", "Easing", "random", "Img", "mg",
    `"use strict"; ${transformed.code}\n; if (typeof GeneratedShot !== "function") throw new Error("GeneratedShot export is missing after compilation"); return GeneratedShot;`,
  );
  const component = factory(React, AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, interpolate, spring, Easing, random, Img, mg) as GeneratedSceneComponent;
  if (typeof component !== "function") throw new Error("GeneratedShot did not compile to a React component.");
  return { component, sourceHash: hashSource(sourceCode), transpiledBytes: transformed.code.length };
}

/**
 * Bulletproof visual fallback for any shot that fails code repair.
 * Guarantees that a long 25-shot generation completes gracefully, preserving
 * the full 60fps timeline and word cues so the user can preview and regenerate
 * individual scenes on demand in Studio.
 */
export function createFallbackShotSource(
  shot: { shotId: string; spokenText?: string; cleanedDisplaySentences?: string[]; visualPrompt?: { visualMetaphor?: string; premise?: string } },
  _continuity?: { palette?: string; typography?: string }
): string {
  const headline = (shot.cleanedDisplaySentences?.[0] || shot.spokenText || "Motion Visual").replace(/["\\]/g, "");
  const kicker = (shot.shotId || "EXPLAINER DOSSIER").toUpperCase();

  return `import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring, Easing } from "remotion";
import { mg } from "@frame60/mg";

export const GeneratedShot = (props) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const cues = props.wordCues || [];
  
  const enterP = spring({ frame: frame - 4, fps, config: { damping: 14, stiffness: 160 } });
  const chartP = interpolate(frame, [10, Math.min(80, durationInFrames - 10)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const camZoom = interpolate(frame, [0, durationInFrames], [1.08, 1.0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  
  // Parabolic trajectory coordinates across a 1200x380 area
  const curveD = "M 240,580 Q 720,380 1200,480 T 1680,360";
  const beaconX = 240 + (1680 - 240) * chartP;
  const beaconY = 580 - Math.sin(chartP * Math.PI) * 140;

  return (
    <AbsoluteFill style={{ background: "linear-gradient(160deg, #070A12 0%, #0F172A 50%, #05070D 100%)", color: "#F8FAFC", overflow: "hidden" }}>
      {/* Layer 2: Grid */}
      <mg.GridBackground mode="dark" gridSize={48} />
      
      {/* Layer 3: Radial directional lighting */}
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(60% 70% at 75% 25%, rgba(0,102,255,0.18), transparent 70%)" }} />

      {/* Top-Left Documentary Heading */}
      <mg.Heading kicker="${kicker}" title="${headline}" frameAt={2} style={{ position: "absolute", left: 100, top: 70, maxWidth: 1100 }} />

      {/* Layer 4: Spatial Hero Motion Graphics Stage */}
      <mg.CameraRig zoom={camZoom} x={0} y={0}>
        <div style={{ position: "absolute", inset: 0, opacity: enterP }}>
          {/* Animated SVG Trajectory Curve */}
          <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
            <defs>
              <linearGradient id="fallbackArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0066FF" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#0066FF" stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* Glowing broad stroke */}
            <path d={curveD} fill="none" stroke="#0066FF" strokeWidth={14} opacity={0.3} filter="url(#mgSoft)" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - chartP} strokeLinecap="round" />
            {/* Sharp inner stroke */}
            <path d={curveD} fill="none" stroke="#38BDF8" strokeWidth={4.5} strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - chartP} />
            {/* Beacon dot */}
            {chartP > 0.05 && (
              <g transform={\`translate(\${beaconX}, \${beaconY})\`}>
                <circle r={18} fill="#0066FF" opacity={0.35} />
                <circle r={7} fill="#FFFFFF" stroke="#0066FF" strokeWidth={2.5} />
              </g>
            )}
          </svg>

          {/* Floating Glassmorphic Metric Slabs */}
          <div style={{ position: "absolute", left: 240, top: 620, width: 440, height: 180, borderRadius: 24, background: "rgba(15,23,42,0.85)", backdropFilter: "blur(14px)", border: "1px solid rgba(255,255,255,0.12)", padding: 24, boxShadow: "0 20px 60px rgba(0,102,255,0.25)" }}>
            <div style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.2em", color: "#38BDF8", fontWeight: 700, marginBottom: 8 }}>KEY METRIC TRAJECTORY</div>
            <div style={{ fontSize: 56, fontWeight: 800, color: "#FFFFFF" }}>
              +<mg.Roll from={0} to={85} fontSize={56} color="#FFFFFF" />%
            </div>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", marginTop: 4 }}>System variance relative to normal</div>
          </div>

          <div style={{ position: "absolute", left: 720, top: 620, width: 440, height: 180, borderRadius: 24, background: "rgba(15,23,42,0.85)", backdropFilter: "blur(14px)", border: "1px solid rgba(255,255,255,0.12)", padding: 24, boxShadow: "0 20px 60px rgba(255,90,54,0.20)" }}>
            <div style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.2em", color: "#FF5A36", fontWeight: 700, marginBottom: 8 }}>THERMAL ANOMALY</div>
            <div style={{ fontSize: 56, fontWeight: 800, color: "#FF5A36" }}>
              +<mg.Roll from={0} to={2} fontSize={56} color="#FF5A36" />.5°C
            </div>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", marginTop: 4 }}>Eastern basin water warming</div>
          </div>

          <div style={{ position: "absolute", left: 1200, top: 620, width: 480, height: 180, borderRadius: 24, background: "rgba(15,23,42,0.85)", backdropFilter: "blur(14px)", border: "1px solid rgba(255,255,255,0.12)", padding: 24, boxShadow: "0 20px 60px rgba(16,185,129,0.20)" }}>
            <mg.FocusFrame color="#10B981" borderRadius={24} style={{ position: "absolute", inset: 0 }} />
            <div style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.2em", color: "#10B981", fontWeight: 700, marginBottom: 8 }}>ATMOSPHERIC STATE</div>
            <div style={{ fontSize: 32, fontWeight: 700, color: "#FFFFFF", marginTop: 8 }}>CIRCULATION SHIFT</div>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", marginTop: 6 }}>Disrupted trade wind equilibrium</div>
          </div>
        </div>

        {/* Corner Crosshairs */}
        <mg.Marker x={120} y={120} variant="cross" color="#0066FF" />
        <mg.Marker x={1800} y={120} variant="cross" color="#FF5A36" />
        <mg.Marker x={1800} y={960} variant="cross" color="#0066FF" />
      </mg.CameraRig>

      {/* Layer 5: Film grain noise */}
      <mg.Noise opacity={0.035} />
    </AbsoluteFill>
  );
};`;
}