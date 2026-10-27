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
import type { ShotVisualPrompt, WordCue, CreativeShotPlan } from "../sdk/contract.generated";

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
  assets: string[];
}

export type GeneratedSceneComponent = React.ComponentType<GeneratedSceneProps>;

const REMOTION_IMPORTS = new Set([
  "AbsoluteFill", "Sequence", "useCurrentFrame", "useVideoConfig", "interpolate", "spring", "Easing", "random", "Img",
]);
const SAFE_HTML = new Set([
  // Layout & structural
  "div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6", "header", "footer", "section", "article", "main", "aside", "figure", "figcaption",
  // Text formatting
  "strong", "em", "b", "i", "small", "code", "pre", "blockquote", "mark", "sub", "sup",
  // Lists
  "ul", "ol", "li",
  // Tables
  "table", "thead", "tbody", "tr", "th", "td",
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
  const headline = (shot.cleanedDisplaySentences?.[0] || shot.spokenText || "Visual Sequence").replace(/["\\]/g, "");
  const metaphor = (shot.visualPrompt?.visualMetaphor || shot.visualPrompt?.premise || "Voice-aligned motion sequence").replace(/["\\]/g, "");
  return `import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring, Easing } from "remotion";
import { mg } from "@frame60/mg";

export const GeneratedShot = (props) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const cues = props.wordCues || [];
  
  const bgOpacity = interpolate(frame, [0, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const contentP = spring({ frame: frame - 4, fps, config: { stiffness: 90, damping: 18 } });
  const cameraZoom = interpolate(frame, [0, Math.max(1, durationInFrames)], [1, 1.03], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: "#070A12", color: "#F4F6F9", padding: "100px 120px", display: "flex", flexDirection: "column", justifyContent: "center", opacity: bgOpacity, overflow: "hidden" }}>
      <mg.CameraRig zoom={cameraZoom} x={0} y={0}>
        <div style={{ position: "relative", zIndex: 10, maxWidth: 1400 }}>
          <div style={{ fontFamily: "monospace", fontSize: 18, color: "#0066FF", letterSpacing: "0.25em", textTransform: "uppercase", marginBottom: 28, opacity: interpolate(frame, [0, 10], [0, 0.9], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
            ${shot.shotId} · VOICE SEQUENCE
          </div>
          <h1 style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.1, letterSpacing: "-0.03em", marginBottom: 32, transform: \`translateY(\${(1 - contentP) * 30}px)\`, opacity: contentP }}>
            ${headline}
          </h1>
          <div style={{ fontSize: 22, lineHeight: 1.5, color: "rgba(244,246,249,0.72)", maxWidth: 1100, marginBottom: 44 }}>
            ${metaphor}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 14px", fontSize: 26, fontWeight: 600 }}>
            {cues.map((c, i) => (
              <mg.WordCue key={i} cue={c} emphasis={i % 5 === 0} emphasisColor="#0066FF">
                {c.text}
              </mg.WordCue>
            ))}
          </div>
        </div>
        <mg.Noise opacity={0.035} />
      </mg.CameraRig>
    </AbsoluteFill>
  );
};`;
}