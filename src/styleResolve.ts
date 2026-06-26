// Resolves a MapLibre style layer's paint properties to concrete values for a
// given feature and zoom, mirroring exactly what the GPU renderer computes.
// This is what lets the SVG export match the on-screen map: instead of using
// hardcoded tokens, we read the live style and evaluate its expressions.

import { createExpression, v8 } from "@maplibre/maplibre-gl-style-spec";

// A compiled, evaluatable style expression. The style-spec package types its
// internal expression loosely, so we capture only the call surface we use.
type CompiledExpression = {
  evaluate: (
    globals: { zoom: number },
    feature?: { type: number; properties: Record<string, unknown> },
  ) => unknown;
};

// MapLibre's Color, returned by color-typed expressions. `rgb` gives sRGB
// components (0..1) with alpha un-premultiplied.
type EvaluatedColor = { rgb: [number, number, number, number] };

// Cache compiled expressions per `layerId|prop`; compiling is the costly step
// and must not run once per feature (would make export O(features) compiles).
const expressionCache = new Map<string, CompiledExpression | null>();

// Map a MapLibre paint property to its style-spec definition so expressions
// (notably color interpolation) compile with the correct output type.
const PAINT_SPEC: Record<string, unknown> = {
  "fill-color": v8.paint_fill["fill-color"],
  "fill-opacity": v8.paint_fill["fill-opacity"],
  "fill-outline-color": v8.paint_fill["fill-outline-color"],
  "fill-extrusion-color": v8["paint_fill-extrusion"]["fill-extrusion-color"],
  "fill-extrusion-opacity": v8["paint_fill-extrusion"]["fill-extrusion-opacity"],
  "line-color": v8.paint_line["line-color"],
  "line-opacity": v8.paint_line["line-opacity"],
  "line-width": v8.paint_line["line-width"],
  "line-dasharray": v8.paint_line["line-dasharray"],
  "background-color": v8.paint_background["background-color"],
  "background-opacity": v8.paint_background["background-opacity"],
};

function compile(cacheKey: string, prop: string, raw: unknown): CompiledExpression | null {
  if (expressionCache.has(cacheKey)) return expressionCache.get(cacheKey)!;
  const spec = PAINT_SPEC[prop] ?? null;
  const result = createExpression(raw, spec as never);
  const compiled = result.result === "success" ? (result.value as CompiledExpression) : null;
  expressionCache.set(cacheKey, compiled);
  return compiled;
}

// Geometry type code expected by style expressions evaluating feature-state
// independent paint (2 = LineString, 3 = Polygon cover our fill/line layers).
const GEOM_TYPE_CODE = 3;

/**
 * Evaluate a single paint property of a layer for a feature at a zoom level.
 * Returns `undefined` when the layer does not define the property.
 */
export function evaluatePaint(
  layerId: string,
  prop: string,
  rawValue: unknown,
  zoom: number,
  properties: Record<string, unknown>,
): unknown {
  if (rawValue === undefined || rawValue === null) return undefined;
  const compiled = compile(`${layerId}|${prop}`, prop, rawValue);
  if (!compiled) return undefined;
  try {
    return compiled.evaluate({ zoom }, { type: GEOM_TYPE_CODE, properties });
  } catch {
    return undefined;
  }
}

/** Convert an evaluated color into a CSS string, folding in an opacity factor. */
export function colorToCss(value: unknown, opacityFactor = 1): string | undefined {
  const color = value as EvaluatedColor | undefined;
  if (!color || !Array.isArray(color.rgb) || color.rgb.length < 4) return undefined;
  const [r, g, b, a] = color.rgb;
  // Guard against malformed expressions producing NaN/Infinity, which would
  // otherwise emit invalid CSS like `rgb(255, 0, NaN)` into the SVG.
  if (![r, g, b, a].every(Number.isFinite)) return undefined;
  const alpha = clamp01(a * opacityFactor);
  const to255 = (c: number) => Math.round(clamp01(c) * 255);
  if (alpha >= 1) return `rgb(${to255(r)}, ${to255(g)}, ${to255(b)})`;
  return `rgba(${to255(r)}, ${to255(g)}, ${to255(b)}, ${Math.round(alpha * 1000) / 1000})`;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Reset the expression cache. Call when the map style changes. */
export function clearStyleResolveCache(): void {
  expressionCache.clear();
}
