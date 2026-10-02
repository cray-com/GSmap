# GSmap

GSmap2 is a client-side publishing fork of [GSmap](https://github.com/hzguz/GSmap).
Select an OpenStreetMap-based area, import your points, style their labels and
export a **PNG**. The original experimental SVG exporter remains available.

- Search by place name (Nominatim) or by coordinates
- Pan/zoom the map and select a rectangular area (Shift + drag)
- Adjust the selection after drawing: drag the edge/corner handles to resize,
  drag the interior to move, then **Accept** or **Revert**
- Eight map styles: Positron, Dark, Liberty, Bright, Fiord, Monochrome,
  Warm Paper and Blueprint, with road, building and background overrides
- Export a high-fidelity SVG that mirrors what you see on screen — colors,
  line widths, layer order and clipping are derived from the live map style,
  not a fixed re-styling
- PNG export at 1×/2×/3×/4×, custom pixel dimensions, or A4/A3 at 300 DPI
- A separate **Points & labels** menu for JSON/GeoJSON import and styling
- Optional click-to-add mode, undo and GeoJSON download
- History of your last 5 searches, coordinates and selections (stored locally)
- 100% open source, all dependencies and data sources are commercial-use
  friendly (subject to each service's usage policy — see below)

## Stack

- React + TypeScript + Vite (MIT)
- MapLibre GL JS (BSD-3) for the interactive map
- OpenFreeMap vector tiles + OpenMapTiles styles for the basemap (MIT styles,
  ODbL data)
- Nominatim for name search (ODbL data; OSMF service)

No backend is required. The app runs entirely in the browser; the only network
calls are the basemap tiles (OpenFreeMap) and, when you search by name,
Nominatim. **The SVG export is generated fully client-side from the already
loaded map style — it makes no additional network request.**

## Run locally

```sh
yarn
yarn dev
```

Open http://localhost:5173.

To produce a production build:

```sh
yarn build
yarn preview
```

## Usage

1. Search for a place by name, paste `lat, lon` and press Go, or just pan/zoom.
2. Hold **Shift** and drag a rectangle on the map.
3. Fine-tune the selection: drag the handles on the edges/corners to resize,
   drag inside the box to move it, then click **Accept** (or **Revert** to
   undo your adjustments). Clicking an accepted selection re-opens editing.
4. Pick a map style; optionally override the roads, buildings, and background
   colors. Toggle labels or buildings off if you want a cleaner export.
5. Open **Points & labels**. Paste JSON or drop/upload `.json`/`.geojson` in **Pins**. Supported roots are the documented `{pins:[{lat,lon,...}], bounds?}`, GeoJSON `FeatureCollection` Point features (`[lon,lat]`), and top-level record arrays with case-insensitive `latitude/longitude`, `lat/lon`, or `lat/lng`. The detected format and coordinate fields are shown. Labels are selected as `label`, `name`, `title`, `project`, `location_name`, `id`; original properties are preserved. Loading JSON without `bounds` computes padded bounds from the pins and fits the map (a single pin is flown to at zoom 14).
6. Identical coordinates render as one native MapLibre circle; there is no spatial spreading. **Point style** controls radius, colors, stroke, opacity and optional square-root scaling of duplicate circles with a configurable cap. Labels use a separate native symbol layer: select a scalar property (with field coverage shown), position, size, colors, halo, overlap and an optional suffix showing the number of additional records. The first record supplies the label for aggregated duplicates. PNG includes both layers naturally; SVG remains unchanged and excludes user points and labels.
7. For individual additions, enter an optional label and enable **Add by clicking**.
   Click the map to add a point. Dragging, Shift and double-clicks do not add points.
   **Done** or Escape leaves the mode. **Undo point** removes the latest manual
   addition, not imported records. Use **Save points as GeoJSON** to keep your data;
   point data otherwise remains in this browser session. Loading another document
   replaces the loaded points.
8. Choose **PNG size** in the export dock, then **Export PNG**. Use a quick scale,
   custom width/height, or A4/A3 in portrait/landscape. PNG includes attribution.
9. **Local SVG** remains experimental. It excludes basemap text and user points.
   Its layers can be edited as separate `<g>` groups in a vector editor.

## PNG sizes and limits

- 1× uses logical map pixels, not the display's Retina/device pixel ratio.
  2×, 3× and 4× multiply both file dimensions exactly. Native rendering increases
  resolution while preserving the apparent point, line and text sizes.
- A4 is 2480 × 3508 pixels; A3 is 3508 × 4961 pixels. Landscape swaps the axes.
  Print exports include genuine 300 DPI PNG metadata and render styles at that density.
- Custom pixel sizes render at native output pixels with the map zoom needed to
  fit the selection. Increasing pixels is not a guarantee of additional map data.
- A separate export map renders the complete selection. The live camera and
  selection editor are not moved. Different page proportions add centered margins,
  rather than stretching the map or intentionally adding surrounding geography.
- Minimum output is 256 × 64 pixels so attribution fits. Maximum output is
  32 million pixels, subject to the browser's graphics and canvas limits.
  Requested and actual buffer/image sizes are checked; unsupported sizes fail
  with an error rather than downloading a silently reduced PNG.
- Map tiles, glyphs and sprites must load successfully. Exports time out after
  60 seconds and clean up their temporary map on success or failure.

## Development checks

```sh
yarn typecheck
yarn test
yarn build
```

Before a release, also check actual downloaded PNG dimensions at 1× and 4×,
A4/A3 resolution metadata, labels after a theme switch, and click-to-add/undo
with both JSON and GeoJSON. A passing build alone does not verify WebGL export.

For a Chromium tab launched with `--remote-debugging-port=9231`, run:

```sh
yarn test:browser http://127.0.0.1:9231 http://127.0.0.1:4173/
```

The script checks real PNG bytes at 1×–4×, a custom size and both print sizes,
300 DPI metadata, the unchanged live camera, and removal of temporary maps.
It saves the PNGs in a temporary directory for visual inspection. Run it in a
fresh test browser profile, not a browser containing personal tabs.

## SVG structure

The export walks the live map style's layers in render order, resolving each
layer's real paint (color, width, opacity, dash) at the current zoom. The
result is one `<g>` per style layer, clipped to the exact selection rectangle:

```
<svg>
  <metadata>Map data © OpenStreetMap contributors, ODbL.</metadata>
  <defs><clipPath id="bbox">…</clipPath></defs>
  <rect id="background" .../>
  <g clip-path="url(#bbox)">
    <g id="water" .../>
    <g id="landuse_residential" .../>
    <g id="building" .../>
    <g id="road_major" .../>
    …
  </g>
</svg>
```

Geometry is projected with the same projection as the on-screen map (screen
pixels), so stroke widths map 1:1 and the SVG matches the preview.

## Licensing & attribution

- This project is MIT licensed.
- Map data © OpenStreetMap contributors, available under the
  [Open Database License (ODbL)](https://www.openstreetmap.org/copyright).
  The exported SVG embeds a `<metadata>` attribution element. When publishing
  artwork derived from these exports, keep an OSM credit visible.
- The basemap is served by OpenFreeMap (MIT styles, OpenMapTiles schema) and
  name search by the OpenStreetMap Foundation's Nominatim. **Their usage
  policies forbid heavy automated or high-volume use.** For production at
  scale, switch to a self-hosted basemap + Nominatim, or a commercial
  OSM-based provider.

## Notes & limitations

- Text labels (`symbol` layers) are not vectorized: their on-screen positions
  come from a runtime collision engine that has no faithful SVG equivalent.
- Image-based fills/lines (`fill-pattern`, `line-pattern`), if a style uses
  them, fall back to the resolved solid color.
- Data-driven paint that varies within a single style layer is approximated
  from the layer's first feature.
