# GSmap

Open source web app for selecting an area of an OpenStreetMap-based map and
exporting it as a real, editable vector **SVG** ready for any design or
illustration tool.

- Search by place name (Nominatim) or by coordinates
- Pan/zoom the map and select a rectangular area (Shift + drag)
- Adjust the selection after drawing: drag the edge/corner handles to resize,
  drag the interior to move, then **Accept** or **Revert**
- Five map styles (Positron, Dark, Liberty, Bright, Fiord) with per-style
  overrides for **roads**, **buildings**, and **background** colors
- Export a high-fidelity SVG that mirrors what you see on screen — colors,
  line widths, layer order and clipping are derived from the live map style,
  not a fixed re-styling
- Export a PNG raster of the selection (1×/2×/3×)
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
5. To add points, paste JSON or drop/upload `.json`/`.geojson` in **Pins**. Supported roots are the documented `{pins:[{lat,lon,...}], bounds?}`, GeoJSON `FeatureCollection` Point features (`[lon,lat]`), and top-level record arrays with case-insensitive `latitude/longitude`, `lat/lon`, or `lat/lng`. The detected format and coordinate fields are shown. Labels are selected as `label`, `name`, `title`, `project`, `location_name`, `id`; original properties are preserved. Loading JSON without `bounds` computes padded bounds from the pins and fits the map (a single pin is flown to at zoom 14).
6. Identical coordinates render as one pin, scaled by `sqrt(duplicateCount)` with a cap. The custom template receives `duplicateCount` and `duplicateScale`; duplicates are not spread and no badge is required. In **Custom pin**, edit a draft and click **Apply template**, or upload `.html` and `.css`. The constrained subset supports `{{field}}` (HTML-escaped), ordinary CSS selectors, flex/layout, spacing, borders and transforms; JavaScript, event handlers, iframe/object/embed, remote URLs, `url()` and `@import` are rejected. Sanitized HTML/CSS is rendered in an isolated document and rasterized into a high-resolution MapLibre icon, so live map, PNG export and style switches match. Reset restores the default. Custom pins are intentionally excluded from SVG.
7. Click **Local SVG** to download the vector export, or **Export PNG** for a raster image. PNG exports include the required OpenStreetMap and basemap attribution.
8. Open the SVG in your vector editor of choice. Each map-style layer is a
   separate `<g>` so you can edit them independently.

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
