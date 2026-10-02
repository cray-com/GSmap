import type { StyleSpecification } from "maplibre-gl";

// Shared theme tokens used by both the map preview and the SVG export.

export type ThemeTokens = {
  primary: string;
  secondary: string;
  background: string;
  water: string;
  roads: string;
  parks: string;
  buildings: string;
  labels: string;
};

export type MapStyleId =
  | "positron"
  | "dark"
  | "liberty"
  | "bright"
  | "fiord"
  | "monochrome"
  | "paper"
  | "blueprint";

export type MapStyleDef = {
  id: MapStyleId;
  label: string;
  styleUrl: string;
  attribution: string;
  tokens: ThemeTokens;
  recolor?: boolean;
};

// Base styles are served by OpenFreeMap (MIT-licensed styles + ODbL data),
// free for commercial use without API keys. See LicensePage for sources.
const OFM_ATTRIBUTION =
  "© OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors";

export const MAP_STYLES: MapStyleDef[] = [
  {
    id: "positron",
    label: "Positron (light)",
    styleUrl: "https://tiles.openfreemap.org/styles/positron",
    attribution: OFM_ATTRIBUTION,
    tokens: {
      primary: "#0f766e",
      secondary: "#94a3b8",
      background: "#f5f5f3",
      water: "#aad3df",
      roads: "#ffffff",
      parks: "#d8f1c0",
      buildings: "#dddcd4",
      labels: "#333333",
    },
  },
  {
    id: "dark",
    label: "Dark (deep)",
    styleUrl: "https://tiles.openfreemap.org/styles/dark",
    attribution: OFM_ATTRIBUTION,
    tokens: {
      primary: "#6da6ff",
      secondary: "#475569",
      background: "#0c0c0c",
      water: "#1a1f2e",
      roads: "#2a2a2a",
      parks: "#102014",
      buildings: "#1a1a1d",
      labels: "#cccccc",
    },
  },
  {
    id: "liberty",
    label: "Liberty",
    styleUrl: "https://tiles.openfreemap.org/styles/liberty",
    attribution: OFM_ATTRIBUTION,
    tokens: {
      primary: "#3b82f6",
      secondary: "#6b7280",
      background: "#f8f4f0",
      water: "#a0c8e0",
      roads: "#ffffff",
      parks: "#c8e6a0",
      buildings: "#e4ddd3",
      labels: "#222222",
    },
  },
  {
    id: "bright",
    label: "Bright",
    styleUrl: "https://tiles.openfreemap.org/styles/bright",
    attribution: OFM_ATTRIBUTION,
    tokens: {
      primary: "#e63946",
      secondary: "#457b9d",
      background: "#f1faee",
      water: "#a8dadc",
      roads: "#ffffff",
      parks: "#b7e4c7",
      buildings: "#e3e1d9",
      labels: "#1d3557",
    },
  },
  {
    id: "fiord",
    label: "Dark (soft) — Fiord",
    styleUrl: "https://tiles.openfreemap.org/styles/fiord",
    attribution: OFM_ATTRIBUTION,
    tokens: {
      primary: "#8ab4f8",
      secondary: "#a3aec3",
      background: "#45516e",
      water: "#38435c",
      roads: "#5a6478",
      parks: "#4d5b6e",
      buildings: "#525d75",
      labels: "#e6e9ef",
    },
  },
];

MAP_STYLES.push(
  {
    id: "monochrome", label: "Monochrome", recolor: true,
    styleUrl: MAP_STYLES[0].styleUrl, attribution: OFM_ATTRIBUTION,
    tokens: {
      primary: "#303030", secondary: "#aaaaaa", background: "#ffffff",
      water: "#d7d7d7", roads: "#888888", parks: "#e8e8e8",
      buildings: "#bcbcbc", labels: "#252525",
    },
  },
  {
    id: "paper", label: "Warm Paper", recolor: true,
    styleUrl: MAP_STYLES[0].styleUrl, attribution: OFM_ATTRIBUTION,
    tokens: {
      primary: "#805d3a", secondary: "#c4b7a3", background: "#f5efdf",
      water: "#b5c9ca", roads: "#fffaf0", parks: "#d8ddbf",
      buildings: "#d5c6af", labels: "#514738",
    },
  },
  {
    id: "blueprint", label: "Blueprint", recolor: true,
    styleUrl: MAP_STYLES[0].styleUrl, attribution: OFM_ATTRIBUTION,
    tokens: {
      primary: "#c7e4f3", secondary: "#4b7490", background: "#153b56",
      water: "#102c42", roads: "#7baac7", parks: "#234a60",
      buildings: "#356382", labels: "#e2f0f8",
    },
  },
);

/** Reuse Positron's geometry, typography and zoom rules with a local palette. */
export function createStyleVariant(style: StyleSpecification, styleId: MapStyleId): StyleSpecification {
  const def = getStyleDef(styleId);
  if (!def.recolor) return style;
  const { tokens } = def;
  const layers = style.layers.map((layer) => {
    const sourceLayer = "source-layer" in layer ? layer["source-layer"] : "";
    const name = `${layer.id} ${sourceLayer}`.toLowerCase();
    const water = name.includes("water");
    const park = /park|landcover/.test(name);
    if (layer.type === "background") {
      return { ...layer, paint: { ...layer.paint, "background-color": tokens.background } };
    }
    if (layer.type === "fill") {
      const color = water ? tokens.water : park ? tokens.parks
        : name.includes("building") ? tokens.buildings : tokens.background;
      return { ...layer, paint: { ...layer.paint, "fill-color": color,
        ...(layer.paint?.["fill-outline-color"] !== undefined ? { "fill-outline-color": tokens.secondary } : {}),
      } };
    }
    if (layer.type === "line") {
      const color = water ? tokens.water
        : /casing|rail|boundary/.test(name) ? tokens.secondary : tokens.roads;
      return { ...layer, paint: { ...layer.paint, "line-color": color } };
    }
    if (layer.type === "symbol") {
      return { ...layer, paint: { ...layer.paint, "text-color": tokens.labels,
        "text-halo-color": tokens.background } };
    }
    return layer;
  });
  return { ...style, name: def.label, layers };
}

export const DEFAULT_STYLE_ID: MapStyleId = "positron";

export function getStyleDef(id: MapStyleId): MapStyleDef {
  return MAP_STYLES.find((s) => s.id === id) ?? MAP_STYLES[0];
}

export function buildTokens(
  styleId: MapStyleId,
  primaryOverride?: string,
  roadsOverride?: string | null,
): ThemeTokens {
  const base = getStyleDef(styleId).tokens;
  return {
    ...base,
    primary: primaryOverride || base.primary,
    roads: roadsOverride || base.roads,
  };
}

// Keep ThemeName as a union for legacy compat (used in MapView to pick dark bg).
export type ThemeName = "light" | "dark";

// Derive whether a style is "dark" for UI purposes.
export function isDarkStyle(id: MapStyleId): boolean {
  return id === "dark" || id === "fiord" || id === "blueprint";
}
