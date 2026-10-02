import { describe, expect, it } from "vitest";
import type { StyleSpecification } from "maplibre-gl";
import { createStyleVariant, getStyleDef, isDarkStyle, MAP_STYLES } from "./theme";

const original: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#ffffff" } },
    { id: "water", type: "fill", source: "tiles", "source-layer": "water", paint: { "fill-color": "#ffffff", "fill-opacity": 0.7 } },
    { id: "road", type: "line", source: "tiles", paint: { "line-color": "#ffffff", "line-width": 2 } },
    { id: "place", type: "symbol", source: "tiles", layout: { "text-font": ["Noto Sans Regular"] } },
  ],
};

describe("local theme variants", () => {
  it("reuses the provider and geometry without mutating the base style", () => {
    expect(createStyleVariant(original, "positron")).toBe(original);
    for (const id of ["monochrome", "paper", "blueprint"] as const) {
      const variant = createStyleVariant(original, id);
      expect(variant.sources).toBe(original.sources);
      expect(variant.layers.map((layer) => layer.id)).toEqual(original.layers.map((layer) => layer.id));
      expect(variant.layers[1].paint).toEqual({ "fill-color": getStyleDef(id).tokens.water, "fill-opacity": 0.7 });
      expect(variant.layers[2].paint).toMatchObject({ "line-width": 2 });
      expect(variant.layers[3].layout).toEqual(original.layers[3].layout);
    }
    expect(original.layers[1].paint).toEqual({ "fill-color": "#ffffff", "fill-opacity": 0.7 });
    expect(isDarkStyle("blueprint")).toBe(true);
    expect(new Set(MAP_STYLES.map((style) => style.id)).size).toBe(8);
  });
});
