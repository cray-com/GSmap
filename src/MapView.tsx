import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import maplibregl, { Map as MlMap, LngLatBoundsLike } from "maplibre-gl";
import type { BBox, Geometry, LayerKind, LngLat } from "./types";
import { aggregatePins, type Pin } from "./pins";
import { DEFAULT_PIN_CSS, DEFAULT_PIN_TEMPLATE, rasterizePin, sanitizePinCss, sanitizePinTemplate } from "./pinTemplate";
import { getStyleDef, type MapStyleId } from "./theme";
import type { StyledFeatureSet, StyledLayer, StyledPath } from "./svg";
import { evaluatePaint, colorToCss, clearStyleResolveCache } from "./styleResolve";

export type MapHandle = {
  flyTo: (lng: number, lat: number, zoom?: number) => void;
  fitBbox: (bbox: BBox) => void;
  clearSelection: () => void;
  acceptEdit: () => void;
  revertEdit: () => void;
  getStyledFeatureSetForBbox: (bbox: BBox) => Promise<StyledFeatureSet | null>;
  captureSelectedPng: (bbox: BBox, scale: 1 | 2 | 3) => Promise<Blob>;
};

type EditLabels = {
  accept: string;
  revert: string;
  hint: string;
};

type Props = {
  styleId: MapStyleId;
  hideLabels: boolean;
  hideBuildings: boolean;
  roadsColor: string | null;
  buildingsColor: string | null;
  backgroundColor: string | null;
  editLabels: EditLabels;
  onSelect: (bbox: BBox | null) => void;
  onAcceptSelection: (bbox: BBox) => void;
  pins: Pin[];
  pinTemplate?: string;
  pinCss?: string;
};

// Pixel anchor (relative to the map container) used to position the
// floating edit bar just below the selection box.
type EditBarAnchor = { left: number; top: number };

// Drag roles for the 8 resize handles: 4 corners + 4 edge midpoints.
type HandleRole = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const HANDLE_ROLES: HandleRole[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export const MapView = forwardRef<MapHandle, Props>(function MapView(
  { styleId, hideLabels, hideBuildings, roadsColor, buildingsColor, backgroundColor, editLabels, onSelect, onAcceptSelection, pins, pinTemplate = DEFAULT_PIN_TEMPLATE, pinCss = DEFAULT_PIN_CSS },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<SelectionEditor | null>(null);
  const [editBarAnchor, setEditBarAnchor] = useState<EditBarAnchor | null>(null);
  const editLabelsRef = useRef(editLabels);
  editLabelsRef.current = editLabels;
  const mapRef = useRef<MlMap | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onAcceptSelectionRef = useRef(onAcceptSelection);
  onAcceptSelectionRef.current = onAcceptSelection;
  const hideLabelsRef = useRef(hideLabels);
  hideLabelsRef.current = hideLabels;
  const hideBuildingsRef = useRef(hideBuildings);
  hideBuildingsRef.current = hideBuildings;
  const roadsColorRef = useRef(roadsColor);
  roadsColorRef.current = roadsColor;
  const buildingsColorRef = useRef(buildingsColor);
  buildingsColorRef.current = buildingsColor;
  const backgroundColorRef = useRef(backgroundColor);
  backgroundColorRef.current = backgroundColor;
  const pinsRef = useRef(pins);
  pinsRef.current = pins;
  const pinTemplateRef = useRef(pinTemplate);
  pinTemplateRef.current = pinTemplate;
  const pinCssRef = useRef(pinCss);
  pinCssRef.current = pinCss;

  const selectingRef = useRef(false);
  const startPxRef = useRef<{ x: number; y: number } | null>(null);
  const boxElRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const def = getStyleDef(styleId);
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: def.styleUrl,
      center: [-46.6388, -23.5489],
      zoom: 13,
      preserveDrawingBuffer: true,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    mapRef.current = map;

    const canvas = map.getCanvasContainer();

    const editor = new SelectionEditor({
      map,
      canvas,
      onChange: (bbox) => onSelectRef.current(bbox),
      onAnchorChange: setEditBarAnchor,
    });
    editorRef.current = editor;

    const onMouseDown = (e: MouseEvent) => {
      if (!e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      map.dragPan.disable();
      selectingRef.current = true;
      const rect = canvas.getBoundingClientRect();
      startPxRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      const box = document.createElement("div");
      const accent =
        getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() ||
        "#0f766e";
      box.style.cssText =
        `position:absolute;border:2px dashed ${accent};background:${accent}1f;pointer-events:none;z-index:10;border-radius:4px;`;
      canvas.appendChild(box);
      boxElRef.current = box;

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!selectingRef.current || !startPxRef.current || !boxElRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const cur = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const x = Math.min(cur.x, startPxRef.current.x);
      const y = Math.min(cur.y, startPxRef.current.y);
      const w = Math.abs(cur.x - startPxRef.current.x);
      const h = Math.abs(cur.y - startPxRef.current.y);
      Object.assign(boxElRef.current.style, {
        left: x + "px",
        top: y + "px",
        width: w + "px",
        height: h + "px",
      });
    };

    const onMouseUp = (e: MouseEvent) => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      map.dragPan.enable();
      if (!selectingRef.current || !startPxRef.current) return;
      selectingRef.current = false;
      const rect = canvas.getBoundingClientRect();
      const end = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const start = startPxRef.current;
      startPxRef.current = null;
      if (boxElRef.current) {
        boxElRef.current.remove();
        boxElRef.current = null;
      }
      if (Math.abs(end.x - start.x) < 4 || Math.abs(end.y - start.y) < 4) {
        onSelectRef.current(null);
        return;
      }
      const a = map.unproject([start.x, start.y]);
      const b = map.unproject([end.x, end.y]);
      const bbox: BBox = {
        west: Math.min(a.lng, b.lng),
        east: Math.max(a.lng, b.lng),
        south: Math.min(a.lat, b.lat),
        north: Math.max(a.lat, b.lat),
      };
      drawBbox(map, bbox);
      onSelectRef.current(bbox);
      editor.beginEdit(bbox);
    };

    canvas.addEventListener("mousedown", onMouseDown);

    // Click an already-accepted selection to re-enter edit mode.
    const onSelectionClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (e.originalEvent.shiftKey || editor.isEditing() || !storedBbox) return;
      editor.beginEdit(storedBbox);
    };
    map.on("click", SELECTION_FILL, onSelectionClick);

    // While editing, dragging over the box interior pans the whole selection.
    const onSelectionMouseDown = (e: maplibregl.MapLayerMouseEvent) => {
      if (e.originalEvent.shiftKey || !editor.isEditing()) return;
      e.preventDefault();
      editor.beginMove(e.originalEvent);
    };
    map.on("mousedown", SELECTION_FILL, onSelectionMouseDown);

    // Cursor hint: pointer when clickable, grab while editing the box body.
    const onSelectionEnter = () => {
      canvas.style.cursor = editor.isEditing() ? "grab" : "pointer";
    };
    const onSelectionLeave = () => {
      canvas.style.cursor = "";
    };
    map.on("mouseenter", SELECTION_FILL, onSelectionEnter);
    map.on("mouseleave", SELECTION_FILL, onSelectionLeave);

    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      map.off("click", SELECTION_FILL, onSelectionClick);
      map.off("mousedown", SELECTION_FILL, onSelectionMouseDown);
      map.off("mouseenter", SELECTION_FILL, onSelectionEnter);
      map.off("mouseleave", SELECTION_FILL, onSelectionLeave);
      editor.destroy();
      editorRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap style when the user picks a different map theme.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const def = getStyleDef(styleId);
    originalRoadColors.delete(map);
    originalBuildingColors.delete(map);
    originalBackgroundColors.delete(map);
    // Paint expressions differ per style; drop the resolver cache.
    clearStyleResolveCache();
    const restoreOverlays = () => {
      map.off("idle", restoreOverlays);
      if (!mapRef.current) return;
      redrawStoredBbox(mapRef.current);
      applyLabelVisibility(mapRef.current, hideLabelsRef.current);
      applyBuildingVisibility(mapRef.current, hideBuildingsRef.current);
      applyRoadsColor(mapRef.current, roadsColorRef.current);
      applyBuildingsColor(mapRef.current, buildingsColorRef.current);
      applyBackgroundColor(mapRef.current, backgroundColorRef.current);
      void syncPins(mapRef.current, pinsRef.current, pinTemplateRef.current, pinCssRef.current);
    };
    map.on("idle", restoreOverlays);
    map.setStyle(def.styleUrl);
    return () => {
      map.off("idle", restoreOverlays);
    };
  }, [styleId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    return whenStyleLoaded(map, () => { void syncPins(map, pins, pinTemplateRef.current, pinCssRef.current); });
  }, [pins, pinTemplate, pinCss]);

  // Toggle label visibility without reloading the style.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    applyLabelVisibility(map, hideLabels);
  }, [hideLabels]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    applyBuildingVisibility(map, hideBuildings);
  }, [hideBuildings]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Road color override mutates layer paint; invalidate the resolver cache.
    clearStyleResolveCache();
    if (map.isStyleLoaded()) {
      applyRoadsColor(map, roadsColor);
    } else {
      map.once("styledata", () => {
        if (mapRef.current) applyRoadsColor(mapRef.current, roadsColor);
      });
    }
  }, [roadsColor]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Building color override mutates layer paint; invalidate the resolver cache.
    clearStyleResolveCache();
    if (map.isStyleLoaded()) {
      applyBuildingsColor(map, buildingsColor);
    } else {
      map.once("styledata", () => {
        if (mapRef.current) applyBuildingsColor(mapRef.current, buildingsColor);
      });
    }
  }, [buildingsColor]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Background color override mutates layer paint; invalidate the resolver cache.
    clearStyleResolveCache();
    if (map.isStyleLoaded()) {
      applyBackgroundColor(map, backgroundColor);
    } else {
      map.once("styledata", () => {
        if (mapRef.current) applyBackgroundColor(mapRef.current, backgroundColor);
      });
    }
  }, [backgroundColor]);

  useImperativeHandle(ref, () => ({
    flyTo(lng, lat, zoom) {
      mapRef.current?.flyTo({ center: [lng, lat], zoom: zoom ?? 14 });
    },
    fitBbox(bbox) {
      const bounds: LngLatBoundsLike = [
        [bbox.west, bbox.south],
        [bbox.east, bbox.north],
      ];
      mapRef.current?.fitBounds(bounds, { padding: 60, duration: 600 });
      editorRef.current?.endEdit();
      if (mapRef.current) drawBbox(mapRef.current, bbox);
    },
    clearSelection() {
      const map = mapRef.current;
      if (!map) return;
      editorRef.current?.endEdit();
      clearBbox(map);
    },
    acceptEdit() {
      editorRef.current?.endEdit();
    },
    revertEdit() {
      editorRef.current?.revert();
    },
    getStyledFeatureSetForBbox(bbox) {
      const map = mapRef.current;
      if (!map) return Promise.resolve(null);
      return buildStyledFeatureSetForBbox(map, bbox, editorRef.current);
    },
    captureSelectedPng(bbox, scale) {
      const map = mapRef.current;
      if (!map) return Promise.reject(new Error("Map is not ready"));
      return captureSelectedPng(map, bbox, scale, editorRef.current);
    },
  }));

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map" />
      <div className="help">
        Hold <span className="kbd">Shift</span> and drag to select an area
      </div>
      {editBarAnchor && (
        <div
          className="selection-edit-bar"
          style={{ left: editBarAnchor.left, top: editBarAnchor.top }}
        >
          <span className="selection-edit-hint">{editLabels.hint}</span>
          <div className="selection-edit-actions">
            <button
              type="button"
              className="mini-action"
              onClick={() => editorRef.current?.revert()}
            >
              {editLabels.revert}
            </button>
            <button
              type="button"
              className="mini-action mini-action--accent"
              onClick={() => {
                const accepted = editorRef.current?.getCurrentBbox();
                if (accepted) onAcceptSelectionRef.current(accepted);
                editorRef.current?.endEdit();
              }}
            >
              {editLabels.accept}
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

const PINS_SOURCE = "user-pins";
const PINS_CIRCLE = "user-pins-circle";
const PINS_LABELS = "user-pins-labels";
const pinSyncVersions = new WeakMap<MlMap, number>();

function whenStyleLoaded(map: MlMap, callback: () => void): () => void {
  if ((map.getStyle()?.layers?.length ?? 0) > 0) {
    callback();
    return () => undefined;
  }

  const apply = () => {
    map.off("style.load", apply);
    callback();
  };
  map.on("style.load", apply);
  return () => {
    map.off("style.load", apply);
  };
}

async function syncPins(map: MlMap, pins: Pin[], template = DEFAULT_PIN_TEMPLATE, css = DEFAULT_PIN_CSS): Promise<void> {
  if ((map.getStyle()?.layers?.length ?? 0) === 0) return;
  const version = (pinSyncVersions.get(map) ?? 0) + 1;
  pinSyncVersions.set(map, version);
  const grouped = aggregatePins(pins);
  const data: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: grouped.map((pin, index) => ({
      type: "Feature",
      id: pin.id ?? `pin-${index}`,
      properties: {
        ...pin.properties,
        label: pin.label ?? "",
        duplicateCount: pin.duplicateCount,
        duplicateScale: pin.duplicateScale,
        icon: `user-pin-${index}`,
      },
      geometry: { type: "Point", coordinates: [pin.lon, pin.lat] },
    })),
  };
  sanitizePinCss(css);
  sanitizePinTemplate(template);
  let images: { id: string; image: ImageData }[];
  try {
    images = await Promise.all(grouped.map((pin, index) => rasterizePin(
      template,
      css,
      { ...pin.properties, ...pin, label: pin.label ?? "" },
    ).then((image) => ({ id: `user-pin-${index}`, image }))));
  } catch {
    return;
  }
  if (pinSyncVersions.get(map) !== version || !map.isStyleLoaded()) return;
  try {
    const wanted = new Set(images.map(({ id }) => id));
    for (const image of map.listImages()) {
      if (image.startsWith("user-pin-") && !wanted.has(image)) map.removeImage(image);
    }
    for (const { id, image } of images) {
      if (map.hasImage(id)) map.updateImage(id, image);
      else map.addImage(id, image, { pixelRatio: 2 });
    }
    const source = map.getSource(PINS_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (source) source.setData(data);
    else map.addSource(PINS_SOURCE, { type: "geojson", data });
    if (!map.getLayer(PINS_CIRCLE)) {
      map.addLayer({
        id: PINS_CIRCLE,
        type: "symbol",
        source: PINS_SOURCE,
        layout: {
          "icon-image": ["get", "icon"],
          "icon-size": ["get", "duplicateScale"],
          "icon-anchor": "bottom",
          "icon-allow-overlap": true,
        },
      });
    }
    if (!map.getLayer(PINS_LABELS)) {
      map.addLayer({
        id: PINS_LABELS,
        type: "symbol",
        source: PINS_SOURCE,
        filter: ["==", "label", "__never__"],
        layout: {
          "text-field": ["get", "label"],
          "text-size": 12,
          "text-offset": [0, 1.15],
          "text-anchor": "top",
          "text-allow-overlap": true,
          "text-font": ["Noto Sans Regular"],
        },
        paint: { "text-color": "#20202a", "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
      });
    }
  } catch {
    // A simultaneous style replacement owns the next synchronization.
  }
}

const SELECTION_SOURCE = "selection-bbox";
const SELECTION_FILL = "selection-bbox-fill";
const SELECTION_LINE = "selection-bbox-line";

// Store last bbox so we can redraw it after a style change.
let storedBbox: BBox | null = null;

function redrawStoredBbox(map: MlMap) {
  if (storedBbox) drawBbox(map, storedBbox);
}

function applyLabelVisibility(map: MlMap, hide: boolean) {
  const visibility = hide ? "none" : "visible";
  map.getStyle().layers.forEach((layer) => {
    if (layer.type === "symbol" && layer.id !== PINS_LABELS) {
      map.setLayoutProperty(layer.id, "visibility", visibility);
    }
  });
}

// Snapshot original line-color of road layers the first time we touch them, so
// that clearing the override later can restore the style's authentic palette.
const originalRoadColors = new WeakMap<MlMap, Map<string, unknown>>();

function applyRoadsColor(map: MlMap, color: string | null) {
  let snapshot = originalRoadColors.get(map);
  if (!snapshot) {
    snapshot = new Map();
    originalRoadColors.set(map, snapshot);
  }

  map.getStyle().layers.forEach((layer) => {
    if (layer.type !== "line") return;
    const layerId = layer.id.toLowerCase();
    const sourceLayer = "source-layer" in layer ? String(layer["source-layer"] ?? "").toLowerCase() : "";
    const isRoadLayer =
      sourceLayer === "transportation" ||
      sourceLayer === "road" ||
      layerId.includes("road") ||
      layerId.includes("street") ||
      layerId.includes("highway") ||
      layerId.includes("motorway") ||
      layerId.includes("bridge") ||
      layerId.includes("tunnel") ||
      layerId.includes("path");
    if (!isRoadLayer) return;
    if (layerId.includes("rail") || layerId.includes("ferry") || layerId.includes("runway")) return;

    if (!snapshot!.has(layer.id)) {
      const current = map.getPaintProperty(layer.id, "line-color");
      snapshot!.set(layer.id, current);
    }

    if (color) {
      map.setPaintProperty(layer.id, "line-color", color);
    } else {
      map.setPaintProperty(layer.id, "line-color", snapshot!.get(layer.id));
    }
  });
}

// Built-up landuse classes whose fill visually reads as "buildings" (they share
// the buildings' light grey tone). Parks, cemeteries, schools and sports pitches
// are intentionally excluded so green areas stay visible.
const BUILT_UP_LANDUSE_TERMS = [
  "residential",
  "suburb",
  "neighbourhood",
  "commercial",
  "industrial",
];

// Id/source-layer fragments that denote actual building geometry, in any of its
// forms (fill, 3D extrusion, outline/casing lines, tops).
const BUILDING_TERMS = ["building", "house", "structure"];

// Any layer that draws building geometry, regardless of render type — so a
// style's building outline (line) or 3D top is hidden together with the fill.
function isBuildingLayer(layerId: string, sourceLayer: string): boolean {
  if (sourceLayer === "building") return true;
  return BUILDING_TERMS.some((term) => layerId.includes(term));
}

// Fill polygons that look like buildings without being the building layer
// itself (built-up landuse, airport pavement).
function isBuildingLikeFill(layerId: string, sourceLayer: string): boolean {
  if (sourceLayer === "aeroway" || layerId.includes("aeroway")) return true;
  if (sourceLayer === "landuse" || layerId.includes("landuse")) {
    return BUILT_UP_LANDUSE_TERMS.some((term) => layerId.includes(term));
  }
  return false;
}

function applyBuildingVisibility(map: MlMap, hide: boolean) {
  const visibility = hide ? "none" : "visible";
  map.getStyle().layers.forEach((layer) => {
    const layerId = layer.id.toLowerCase();
    const sourceLayer = "source-layer" in layer ? String(layer["source-layer"] ?? "").toLowerCase() : "";

    // Building geometry in any render type (fill / fill-extrusion / line).
    const isBuilding =
      (layer.type === "fill" || layer.type === "fill-extrusion" || layer.type === "line") &&
      isBuildingLayer(layerId, sourceLayer);

    // Building-like fills only apply to filled polygons.
    const isLikeFill =
      (layer.type === "fill" || layer.type === "fill-extrusion") &&
      isBuildingLikeFill(layerId, sourceLayer);

    if (!isBuilding && !isLikeFill) return;
    map.setLayoutProperty(layer.id, "visibility", visibility);
  });
}

// Snapshot original building fill so clearing the override restores the
// style's authentic palette, mirroring originalRoadColors.
const originalBuildingColors = new WeakMap<MlMap, Map<string, unknown>>();

function applyBuildingsColor(map: MlMap, color: string | null) {
  let snapshot = originalBuildingColors.get(map);
  if (!snapshot) {
    snapshot = new Map();
    originalBuildingColors.set(map, snapshot);
  }

  map.getStyle().layers.forEach((layer) => {
    if (layer.type !== "fill" && layer.type !== "fill-extrusion") return;
    const layerId = layer.id.toLowerCase();
    const sourceLayer = "source-layer" in layer ? String(layer["source-layer"] ?? "").toLowerCase() : "";
    const isBuildingLayer =
      sourceLayer === "building" ||
      layerId.includes("building") ||
      layerId.includes("3d-buildings");
    if (!isBuildingLayer) return;

    const colorProp = layer.type === "fill-extrusion" ? "fill-extrusion-color" : "fill-color";

    if (!snapshot!.has(layer.id)) {
      snapshot!.set(layer.id, map.getPaintProperty(layer.id, colorProp));
    }

    if (color) {
      map.setPaintProperty(layer.id, colorProp, color);
    } else {
      map.setPaintProperty(layer.id, colorProp, snapshot!.get(layer.id));
    }
  });
}

// Snapshot original background-color so clearing the override restores the
// style's authentic backdrop, mirroring originalRoadColors.
const originalBackgroundColors = new WeakMap<MlMap, Map<string, unknown>>();

function applyBackgroundColor(map: MlMap, color: string | null) {
  let snapshot = originalBackgroundColors.get(map);
  if (!snapshot) {
    snapshot = new Map();
    originalBackgroundColors.set(map, snapshot);
  }

  map.getStyle().layers.forEach((layer) => {
    if (layer.type !== "background") return;

    if (!snapshot!.has(layer.id)) {
      snapshot!.set(layer.id, map.getPaintProperty(layer.id, "background-color"));
    }

    if (color) {
      map.setPaintProperty(layer.id, "background-color", color);
    } else {
      map.setPaintProperty(layer.id, "background-color", snapshot!.get(layer.id));
    }
  });
}

function drawBbox(map: MlMap, bbox: BBox) {
  storedBbox = bbox;
  const data: GeoJSON.Feature = {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [bbox.west, bbox.south],
          [bbox.east, bbox.south],
          [bbox.east, bbox.north],
          [bbox.west, bbox.north],
          [bbox.west, bbox.south],
        ],
      ],
    },
  };
  const apply = (): boolean => {
    try {
      const src = map.getSource(SELECTION_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(data);
      } else {
        map.addSource(SELECTION_SOURCE, { type: "geojson", data });
      }

      // Add layers independently of the source: a style swap drops layers but
      // a stale source reference could otherwise leave us with no visible box.
      const accent =
        getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() ||
        "#0f766e";
      if (!map.getLayer(SELECTION_FILL)) {
        map.addLayer({
          id: SELECTION_FILL,
          type: "fill",
          source: SELECTION_SOURCE,
          paint: { "fill-color": accent, "fill-opacity": 0.14 },
        });
      }
      if (!map.getLayer(SELECTION_LINE)) {
        map.addLayer({
          id: SELECTION_LINE,
          type: "line",
          source: SELECTION_SOURCE,
          paint: { "line-color": accent, "line-width": 2, "line-dasharray": [3, 2] },
        });
      }
      return true;
    } catch {
      // Style not ready yet (e.g. mid style-swap); retry later.
      return false;
    }
  };

  // isStyleLoaded() is unreliable right after pan/zoom, so attempt immediately
  // and retry once the map is idle if the style wasn't ready.
  if (!apply()) {
    map.once("idle", () => {
      if (apply()) onBboxRedrawn?.();
    });
  }
}

// Lets the active editor re-layout its handles after a deferred bbox draw.
let onBboxRedrawn: (() => void) | null = null;

// Gap in pixels between the bottom of the selection box and the edit bar.
const EDIT_BAR_GAP = 12;
// Half-size of a resize handle, used to center it on its anchor point.
const HANDLE_HALF = 6;
// CSS cursor per handle role, conveying the resize direction.
const HANDLE_CURSORS: Record<HandleRole, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
};

type SelectionEditorOptions = {
  map: MlMap;
  canvas: HTMLElement;
  onChange: (bbox: BBox) => void;
  onAnchorChange: (anchor: EditBarAnchor | null) => void;
};

/**
 * Owns the interactive editing of a selection box: 8 resize handles, their
 * drag behavior, reprojection on map move/zoom, and the accept/revert
 * lifecycle. The box geometry lives in geographic coordinates (BBox) while the
 * handles are pixel-positioned DOM nodes, so every map movement reprojects
 * them via map.project().
 */
class SelectionEditor {
  private readonly map: MlMap;
  private readonly canvas: HTMLElement;
  private readonly onChange: (bbox: BBox) => void;
  private readonly onAnchorChange: (anchor: EditBarAnchor | null) => void;

  private handles: Map<HandleRole, HTMLDivElement> = new Map();
  private editing = false;
  private originalBbox: BBox | null = null;
  private currentBbox: BBox | null = null;
  private activeRole: HandleRole | null = null;
  // When panning the whole box: pointer start and box snapshot at grab time.
  private moveAnchor: { px: number; py: number; bbox: BBox } | null = null;

  constructor({ map, canvas, onChange, onAnchorChange }: SelectionEditorOptions) {
    this.map = map;
    this.canvas = canvas;
    this.onChange = onChange;
    this.onAnchorChange = onAnchorChange;
    this.layout = this.layout.bind(this);
    this.onDragMove = this.onDragMove.bind(this);
    this.onDragEnd = this.onDragEnd.bind(this);
  }

  beginEdit(bbox: BBox) {
    this.originalBbox = { ...bbox };
    this.currentBbox = { ...bbox };
    if (!this.editing) {
      this.editing = true;
      this.createHandles();
      this.map.on("move", this.layout);
      // Re-layout if the selection box is (re)drawn after a deferred apply.
      onBboxRedrawn = this.layout;
    }
    this.layout();
  }

  /** Restore the box captured when editing started, keeping the selection. */
  revert() {
    if (!this.originalBbox) return;
    this.currentBbox = { ...this.originalBbox };
    drawBbox(this.map, this.currentBbox);
    this.onChange(this.currentBbox);
    this.layout();
  }

  /** Confirm the current box and tear down the editing UI. */
  endEdit() {
    if (!this.editing) return;
    this.editing = false;
    this.map.off("move", this.layout);
    if (onBboxRedrawn === this.layout) onBboxRedrawn = null;
    this.removeDragListeners();
    this.destroyHandles();
    this.originalBbox = null;
    this.currentBbox = null;
    this.activeRole = null;
    this.moveAnchor = null;
    this.onAnchorChange(null);
  }

  destroy() {
    this.endEdit();
  }

  isEditing() {
    return this.editing;
  }

  /**
   * Temporarily hide the handles + edit bar and stop tracking map movement.
   * Used while an export reframes the camera, so the handles don't follow the
   * transient fitBounds/jumpTo and flicker. No-op when not editing.
   */
  suspend() {
    if (!this.editing) return;
    this.map.off("move", this.layout);
    for (const handle of this.handles.values()) handle.style.display = "none";
    this.onAnchorChange(null);
  }

  /** Re-show the handles + edit bar and resume tracking after suspend(). */
  resume() {
    if (!this.editing) return;
    for (const handle of this.handles.values()) handle.style.display = "";
    this.map.on("move", this.layout);
    this.layout();
  }

  getCurrentBbox(): BBox | null {
    return this.currentBbox;
  }

  /** Start panning the whole box from a mousedown over its interior. */
  beginMove(event: MouseEvent) {
    if (!this.editing || !this.currentBbox) return;
    const rect = this.canvas.getBoundingClientRect();
    this.moveAnchor = {
      px: event.clientX - rect.left,
      py: event.clientY - rect.top,
      bbox: { ...this.currentBbox },
    };
    this.map.dragPan.disable();
    window.addEventListener("mousemove", this.onDragMove);
    window.addEventListener("mouseup", this.onDragEnd);
  }

  private createHandles() {
    for (const role of HANDLE_ROLES) {
      const handle = document.createElement("div");
      handle.className = "selection-handle";
      handle.dataset.role = role;
      handle.style.cursor = HANDLE_CURSORS[role];
      handle.addEventListener("mousedown", this.onDragStart);
      this.canvas.appendChild(handle);
      this.handles.set(role, handle);
    }
  }

  private destroyHandles() {
    for (const handle of this.handles.values()) {
      handle.removeEventListener("mousedown", this.onDragStart);
      handle.remove();
    }
    this.handles.clear();
  }

  /** Reproject the current box to pixels and position handles + edit bar. */
  private layout() {
    if (!this.currentBbox) return;
    const { west, east, south, north } = this.currentBbox;
    const midLng = (west + east) / 2;
    const midLat = (south + north) / 2;
    const points: Record<HandleRole, [number, number]> = {
      nw: [west, north],
      n: [midLng, north],
      ne: [east, north],
      e: [east, midLat],
      se: [east, south],
      s: [midLng, south],
      sw: [west, south],
      w: [west, midLat],
    };

    let maxY = -Infinity;
    let sumX = 0;
    for (const role of HANDLE_ROLES) {
      const handle = this.handles.get(role);
      if (!handle) continue;
      const p = this.map.project(points[role]);
      handle.style.left = `${p.x - HANDLE_HALF}px`;
      handle.style.top = `${p.y - HANDLE_HALF}px`;
      maxY = Math.max(maxY, p.y);
      if (role === "n" || role === "s") sumX += p.x;
    }

    // Anchor the edit bar below the box, horizontally centered on the box.
    this.onAnchorChange({ left: sumX / 2, top: maxY + EDIT_BAR_GAP });
  }

  private onDragStart = (event: MouseEvent) => {
    const target = event.currentTarget as HTMLDivElement;
    const role = target.dataset.role as HandleRole | undefined;
    if (!role || !this.currentBbox) return;
    event.preventDefault();
    event.stopPropagation();
    this.activeRole = role;
    this.map.dragPan.disable();
    window.addEventListener("mousemove", this.onDragMove);
    window.addEventListener("mouseup", this.onDragEnd);
  };

  private onDragMove(event: MouseEvent) {
    if (!this.currentBbox) return;
    const rect = this.canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;

    // Box panning: translate the whole box by the pointer's geographic delta.
    if (this.moveAnchor) {
      const from = this.map.unproject([this.moveAnchor.px, this.moveAnchor.py]);
      const to = this.map.unproject([px, py]);
      const dLng = to.lng - from.lng;
      const dLat = to.lat - from.lat;
      const base = this.moveAnchor.bbox;
      this.currentBbox = {
        west: base.west + dLng,
        east: base.east + dLng,
        south: base.south + dLat,
        north: base.north + dLat,
      };
      drawBbox(this.map, this.currentBbox);
      this.onChange(this.currentBbox);
      this.layout();
      return;
    }

    if (!this.activeRole) return;
    const point = this.map.unproject([px, py]);

    // Apply the pointer position only to the edges the role controls.
    const next = { ...this.currentBbox };
    if (this.activeRole.includes("n")) next.north = point.lat;
    if (this.activeRole.includes("s")) next.south = point.lat;
    if (this.activeRole.includes("e")) next.east = point.lng;
    if (this.activeRole.includes("w")) next.west = point.lng;

    // Normalize so the box never inverts when dragged past its opposite edge.
    this.currentBbox = {
      west: Math.min(next.west, next.east),
      east: Math.max(next.west, next.east),
      south: Math.min(next.south, next.north),
      north: Math.max(next.south, next.north),
    };
    drawBbox(this.map, this.currentBbox);
    this.onChange(this.currentBbox);
    this.layout();
  }

  private onDragEnd() {
    this.activeRole = null;
    this.moveAnchor = null;
    this.map.dragPan.enable();
    this.removeDragListeners();
  }

  private removeDragListeners() {
    window.removeEventListener("mousemove", this.onDragMove);
    window.removeEventListener("mouseup", this.onDragEnd);
  }
}

function clearBbox(map: MlMap) {
  storedBbox = null;
  const src = map.getSource(SELECTION_SOURCE) as maplibregl.GeoJSONSource | undefined;
  if (src) {
    src.setData({
      type: "FeatureCollection",
      features: [],
    });
  }
}

// Style layer types we can faithfully vectorize. fill-extrusion is flattened to
// a fill; symbol/raster/etc. have no vector equivalent and are skipped.
const VECTORIZABLE_LAYER_TYPES = new Set(["fill", "fill-extrusion", "line", "background"]);

type StyleLayerLike = {
  id: string;
  type: string;
  layout?: { visibility?: string };
  minzoom?: number;
  maxzoom?: number;
};

// Resolve once the map has finished moving and rendering (tiles loaded).
function waitForIdle(map: MlMap): Promise<void> {
  return new Promise((resolve) => map.once("idle", () => resolve()));
}

// MapLibre interaction handlers we disable while an export reframes the camera,
// so the user cannot pan/zoom mid-capture and invalidate the restore.
const INTERACTION_HANDLERS = [
  "dragPan",
  "scrollZoom",
  "boxZoom",
  "dragRotate",
  "keyboard",
  "doubleClickZoom",
  "touchZoomRotate",
] as const;

/**
 * Frame the bbox in the viewport, run `fn` once the map is idle, then restore
 * the original camera. Interaction is locked for the duration and the active
 * selection editor (if any) is suspended, so the capture is consistent and the
 * handles don't follow the transient camera move.
 *
 * queryRenderedFeatures / the canvas only expose what is currently rasterized,
 * so this framing is what lets off-screen selections export fully.
 */
async function withFramedBbox<T>(
  map: MlMap,
  bbox: BBox,
  editor: SelectionEditor | null,
  fn: () => T | Promise<T>,
): Promise<T> {
  const original = {
    center: map.getCenter(),
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };

  // Lock interaction, remembering which handlers were enabled.
  const wasEnabled = INTERACTION_HANDLERS.map((name) => {
    const handler = map[name];
    const enabled = handler.isEnabled();
    if (enabled) handler.disable();
    return enabled;
  });
  editor?.suspend();

  map.fitBounds(
    [
      [bbox.west, bbox.south],
      [bbox.east, bbox.north],
    ],
    { padding: 40, animate: false, bearing: original.bearing, pitch: original.pitch },
  );
  await waitForIdle(map);

  try {
    return await fn();
  } finally {
    map.jumpTo(original);
    INTERACTION_HANDLERS.forEach((name, i) => {
      if (wasEnabled[i]) map[name].enable();
    });
    editor?.resume();
  }
}

/**
 * Capture the selected bbox as a PNG, framed so off-screen selections render
 * fully before the canvas is cropped.
 */
function captureSelectedPng(
  map: MlMap,
  bbox: BBox,
  scale: 1 | 2 | 3,
  editor: SelectionEditor | null,
): Promise<Blob> {
  return withFramedBbox(map, bbox, editor, () => {
    const originalPixelRatio = window.devicePixelRatio;
    const targetPixelRatio = originalPixelRatio * scale;
    const hasSelectionLayers =
      !!(map.getLayer(SELECTION_FILL) && map.getLayer(SELECTION_LINE));

    const restoreRenderState = () => {
      map.setPixelRatio(originalPixelRatio);
      if (hasSelectionLayers) {
        map.setLayoutProperty(SELECTION_FILL, "visibility", "visible");
        map.setLayoutProperty(SELECTION_LINE, "visibility", "visible");
      }
    };

    const crop = (): Promise<Blob> => {
      const sourceCanvas = map.getCanvas();
      // At targetPixelRatio the canvas physical size is scaled up; CSS crop
      // coords stay in logical pixels so we scale them by the same ratio.
      const cropRect = getCanvasCropForBbox(map, bbox);
      const ratio = sourceCanvas.width / sourceCanvas.clientWidth;
      const srcX = Math.round(cropRect.x * ratio);
      const srcY = Math.round(cropRect.y * ratio);
      const srcW = Math.max(1, Math.round(cropRect.width * ratio));
      const srcH = Math.max(1, Math.round(cropRect.height * ratio));

      const out = document.createElement("canvas");
      out.width = srcW;
      out.height = srcH;
      const ctx = out.getContext("2d");
      if (!ctx) return Promise.reject(new Error("Canvas export is not available"));
      ctx.drawImage(sourceCanvas, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
      drawPngAttribution(ctx, srcW, srcH, ratio);

      restoreRenderState();

      return new Promise<Blob>((resolve, reject) => {
        out.toBlob((blob) => {
          if (!blob) { reject(new Error("PNG export failed")); return; }
          resolve(blob);
        }, "image/png");
      });
    };

    if (hasSelectionLayers) {
      map.setLayoutProperty(SELECTION_FILL, "visibility", "none");
      map.setLayoutProperty(SELECTION_LINE, "visibility", "none");
    }

    // Bump pixel ratio so MapLibre re-renders at the target resolution, then
    // capture on the next rendered frame.
    map.setPixelRatio(targetPixelRatio);
    return new Promise<Blob>((resolve, reject) => {
      map.once("render", () => crop().then(resolve, reject));
      map.triggerRepaint();
    }).catch((err) => {
      restoreRenderState(); // Never leave the canvas at the bumped pixel ratio.
      throw err;
    });
  });
}

function drawPngAttribution(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  pixelRatio: number,
) {
  const text = "© OpenStreetMap contributors · openstreetmap.org/copyright · OpenFreeMap / OpenMapTiles";
  const padding = Math.max(4, Math.round(4 * pixelRatio));
  let fontSize = Math.max(8, Math.round(10 * pixelRatio));

  ctx.save();
  ctx.font = `500 ${fontSize}px sans-serif`;
  const maxTextWidth = Math.max(1, width - padding * 2);
  const measured = ctx.measureText(text).width;
  if (measured > maxTextWidth) {
    fontSize = Math.max(6, Math.floor(fontSize * (maxTextWidth / measured)));
    ctx.font = `500 ${fontSize}px sans-serif`;
  }

  const textWidth = Math.min(ctx.measureText(text).width, maxTextWidth);
  const boxHeight = fontSize + padding * 2;
  const boxWidth = textWidth + padding * 2;
  const x = width - boxWidth;
  const y = height - boxHeight;

  ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
  ctx.fillRect(x, y, boxWidth, boxHeight);
  ctx.fillStyle = "rgba(20, 20, 24, 0.9)";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + padding, y + boxHeight / 2, maxTextWidth);
  ctx.restore();
}

/**
 * Build an export model directly from the live map style. Each visible
 * fill/line layer is walked in render order; its features within the bbox are
 * projected with the same projection as the screen, and its paint (color,
 * width, dash, opacity) is resolved per feature at the current zoom. This is
 * what makes the SVG match the on-screen map instead of a fixed re-styling.
 */
function buildStyledFeatureSetForBbox(
  map: MlMap,
  bbox: BBox,
  editor: SelectionEditor | null,
): Promise<StyledFeatureSet> {
  return withFramedBbox(map, bbox, editor, () => collectStyledLayers(map, bbox));
}

function collectStyledLayers(map: MlMap, bbox: BBox): StyledFeatureSet {
  const crop = getCanvasCropForBbox(map, bbox);
  const { x: minX, y: minY, width, height } = crop;
  const zoom = map.getZoom();
  const queryBox: [[number, number], [number, number]] = [
    [minX, minY],
    [minX + width, minY + height],
  ];

  const styleLayers = map.getStyle().layers as StyleLayerLike[];
  const layers: StyledLayer[] = [];
  let background = "#ffffff";

  for (const styleLayer of styleLayers) {
    if (!VECTORIZABLE_LAYER_TYPES.has(styleLayer.type)) continue;
    if (styleLayer.layout?.visibility === "none") continue;
    if (typeof styleLayer.minzoom === "number" && zoom < styleLayer.minzoom) continue;
    if (typeof styleLayer.maxzoom === "number" && zoom >= styleLayer.maxzoom) continue;

    if (styleLayer.type === "background") {
      const css = resolveLayerColor(map, styleLayer.id, "background-color", "background-opacity", zoom, {});
      if (css) background = css;
      continue;
    }

    const fillType = styleLayer.type === "fill" || styleLayer.type === "fill-extrusion";
    let rendered: maplibregl.MapGeoJSONFeature[];
    try {
      rendered = map.queryRenderedFeatures(queryBox, { layers: [styleLayer.id] });
    } catch {
      continue; // Layer not queryable (e.g. not yet loaded).
    }
    if (rendered.length === 0) continue;

    const paths: StyledPath[] = [];
    const seen = new Set<string>();
    for (const feature of rendered) {
      if (feature.source === SELECTION_SOURCE) continue;
      const geometries = normalizeGeometry(feature.geometry);
      if (geometries.length === 0) continue;
      const baseId = buildFeatureBaseId(feature, "roads");
      const name = readFeatureName(feature.properties);
      geometries.forEach((geometry, index) => {
        const d = projectedPathFromGeometry(map, geometry, minX, minY);
        if (!d) return;
        if (seen.has(d)) return;
        seen.add(d);
        paths.push({ id: `${baseId}-${index}`, name, d });
      });
    }
    if (paths.length === 0) continue;

    // Resolve paint once per layer using the first feature's properties. Most
    // OpenMapTiles layers are constant or zoom-driven; data-driven variation
    // within a single style layer is rare and acceptably approximated.
    const sampleProps = (rendered[0]?.properties ?? {}) as Record<string, unknown>;
    if (fillType) {
      const colorProp = styleLayer.type === "fill" ? "fill-color" : "fill-extrusion-color";
      const opacityProp = styleLayer.type === "fill" ? "fill-opacity" : "fill-extrusion-opacity";
      const fill = resolveLayerColor(map, styleLayer.id, colorProp, opacityProp, zoom, sampleProps);
      const stroke =
        styleLayer.type === "fill"
          ? resolveLayerColor(map, styleLayer.id, "fill-outline-color", "fill-opacity", zoom, sampleProps)
          : undefined;
      layers.push({ id: styleLayer.id, type: "fill", fill, stroke, features: paths });
    } else {
      const stroke = resolveLayerColor(map, styleLayer.id, "line-color", "line-opacity", zoom, sampleProps);
      const widthVal = evaluatePaint(
        styleLayer.id,
        "line-width",
        map.getPaintProperty(styleLayer.id, "line-width"),
        zoom,
        sampleProps,
      );
      const dashVal = evaluatePaint(
        styleLayer.id,
        "line-dasharray",
        map.getPaintProperty(styleLayer.id, "line-dasharray"),
        zoom,
        sampleProps,
      );
      layers.push({
        id: styleLayer.id,
        type: "line",
        stroke,
        strokeWidth: typeof widthVal === "number" ? widthVal : 1,
        dash: Array.isArray(dashVal) ? (dashVal as number[]) : undefined,
        cap: asString(map.getLayoutProperty(styleLayer.id, "line-cap")) ?? "butt",
        join: asString(map.getLayoutProperty(styleLayer.id, "line-join")) ?? "miter",
        features: paths,
      });
    }
  }

  return { width, height, background, layers };
}

// Resolve a layer color property, folding its opacity property into the alpha.
function resolveLayerColor(
  map: MlMap,
  layerId: string,
  colorProp: string,
  opacityProp: string,
  zoom: number,
  props: Record<string, unknown>,
): string | undefined {
  const colorVal = evaluatePaint(layerId, colorProp, map.getPaintProperty(layerId, colorProp), zoom, props);
  if (colorVal === undefined) return undefined;
  const opacityVal = evaluatePaint(layerId, opacityProp, map.getPaintProperty(layerId, opacityProp), zoom, props);
  const opacity = typeof opacityVal === "number" ? opacityVal : 1;
  return colorToCss(colorVal, opacity);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getCanvasCropForBbox(map: MlMap, bbox: BBox) {
  const sw = map.project([bbox.west, bbox.south]);
  const ne = map.project([bbox.east, bbox.north]);
  const minX = Math.min(sw.x, ne.x);
  const maxX = Math.max(sw.x, ne.x);
  const minY = Math.min(sw.y, ne.y);
  const maxY = Math.max(sw.y, ne.y);

  return {
    x: minX,
    y: minY,
    width: Math.max(1, Math.round(maxX - minX)),
    height: Math.max(1, Math.round(maxY - minY)),
  };
}

function normalizeGeometry(geometry: {
  type: string;
  coordinates?: unknown;
}): Geometry[] {
  switch (geometry.type) {
    case "LineString":
      return isCoordPairArray(geometry.coordinates)
        ? [{ type: "LineString", coords: geometry.coordinates.map(toLngLat) }]
        : [];
    case "MultiLineString":
      return isNestedCoordPairArray(geometry.coordinates)
        ? geometry.coordinates.map((coords) => ({ type: "LineString", coords: coords.map(toLngLat) }))
        : [];
    case "Polygon":
      return isPolygonCoords(geometry.coordinates)
        ? [{ type: "Polygon", rings: geometry.coordinates.map((ring) => ring.map(toLngLat)) }]
        : [];
    case "MultiPolygon":
      return isMultiPolygonCoords(geometry.coordinates)
        ? geometry.coordinates.map((rings) => ({
            type: "Polygon",
            rings: rings.map((ring) => ring.map(toLngLat)),
          }))
        : [];
    default:
      return [];
  }
}

function toLngLat(pair: [number, number]): LngLat {
  return { lng: pair[0], lat: pair[1] };
}

function readFeatureName(properties?: Record<string, unknown>): string | undefined {
  const value = properties?.name;
  return typeof value === "string" && value.trim() ? value : undefined;
}

function buildFeatureBaseId(
  feature: {
    id?: string | number;
    source?: string;
    sourceLayer?: string;
    layer?: { id?: string };
    properties?: Record<string, unknown>;
  },
  layerKind: LayerKind,
): string {
  const id = feature.id ?? feature.properties?.osm_id ?? feature.properties?.id ?? "feature";
  const source = String(feature.source ?? "map");
  const sourceLayer = String(feature.sourceLayer ?? feature.layer?.id ?? layerKind);
  return `${source}-${sourceLayer}-${id}`.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function projectedPathFromGeometry(map: MlMap, geometry: Geometry, offsetX: number, offsetY: number): string {
  if (geometry.type === "LineString") {
    return projectedPathFromCoords(map, geometry.coords, false, offsetX, offsetY);
  }
  return geometry.rings
    .map((ring) => projectedPathFromCoords(map, ring, true, offsetX, offsetY))
    .filter(Boolean)
    .join(" ");
}

function projectedPathFromCoords(
  map: MlMap,
  coords: LngLat[],
  close: boolean,
  offsetX: number,
  offsetY: number,
): string {
  if (coords.length === 0) return "";
  let d = "";
  let started = false;
  for (let i = 0; i < coords.length; i++) {
    const point = map.project([coords[i].lng, coords[i].lat]);
    const x = Math.round((point.x - offsetX) * 100) / 100;
    const y = Math.round((point.y - offsetY) * 100) / 100;
    // Skip non-finite projections so we never emit `M NaN NaN` into the SVG.
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    d += `${started ? "L" : "M"}${x} ${y} `;
    started = true;
  }
  if (!started) return "";
  if (close) d += "Z";
  return d.trim();
}

function isCoordPair(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number";
}

function isCoordPairArray(value: unknown): value is [number, number][] {
  return Array.isArray(value) && value.every(isCoordPair);
}

function isNestedCoordPairArray(value: unknown): value is [number, number][][] {
  return Array.isArray(value) && value.every(isCoordPairArray);
}

function isPolygonCoords(value: unknown): value is [number, number][][] {
  return isNestedCoordPairArray(value);
}

function isMultiPolygonCoords(value: unknown): value is [number, number][][][] {
  return Array.isArray(value) && value.every(isPolygonCoords);
}
