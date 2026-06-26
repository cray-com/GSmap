// High-fidelity export model: each entry is one real style layer (in render
// order) carrying its resolved paint, so the SVG mirrors the on-screen map.
export type StyledPath = {
  id: string;
  name?: string;
  d: string;
};

export type StyledLayer = {
  id: string;
  type: "fill" | "line";
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  dash?: number[];
  cap?: string;
  join?: string;
  features: StyledPath[];
};

export type StyledFeatureSet = {
  width: number;
  height: number;
  background: string;
  layers: StyledLayer[];
};

function fmt(n: number): string {
  return Math.round(n * 100) / 100 + "";
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


// Render a StyledFeatureSet whose layers already carry resolved paint from the
// live map style. Geometry is in screen pixels (same projection as the canvas),
// so stroke widths map 1:1 and the result matches the map visually. A clipPath
// trims anything that overflows the selection's exact rectangle.
export function generateStyledSvg(set: StyledFeatureSet): string {
  const { width, height } = set;

  const groups: string[] = [];
  for (const layer of set.layers) {
    if (layer.features.length === 0) continue;

    const attrs: string[] = [];
    if (layer.type === "fill") {
      attrs.push(`fill="${layer.fill ?? "none"}"`);
      attrs.push(`stroke="${layer.stroke ?? "none"}"`);
      if (layer.stroke) attrs.push(`stroke-width="1"`);
      attrs.push(`fill-rule="evenodd"`);
    } else {
      attrs.push(`fill="none"`);
      attrs.push(`stroke="${layer.stroke ?? "none"}"`);
      attrs.push(`stroke-width="${layer.strokeWidth ?? 1}"`);
      attrs.push(`stroke-linecap="${layer.cap ?? "round"}"`);
      attrs.push(`stroke-linejoin="${layer.join ?? "round"}"`);
      if (layer.dash && layer.dash.length > 0) {
        // MapLibre dash units are in line widths; SVG expects user units.
        const w = layer.strokeWidth ?? 1;
        attrs.push(`stroke-dasharray="${layer.dash.map((n) => fmt(n * w)).join(" ")}"`);
      }
    }

    const paths = layer.features
      .map((feature) => {
        const idAttr = ` id="${feature.id.replace(/\//g, "-")}"`;
        const nameAttr = feature.name ? ` data-name="${escapeXml(feature.name)}"` : "";
        return `      <path${idAttr}${nameAttr} d="${feature.d}"/>`;
      })
      .join("\n");

    const groupId = layer.id.replace(/[^a-zA-Z0-9_-]+/g, "-");
    groups.push(`    <g id="${groupId}" ${attrs.join(" ")}>\n${paths}\n    </g>`);
  }

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `  <metadata>Map data © OpenStreetMap contributors, ODbL.</metadata>`,
    `  <defs><clipPath id="bbox"><rect x="0" y="0" width="${width}" height="${height}"/></clipPath></defs>`,
    `  <rect id="background" x="0" y="0" width="${width}" height="${height}" fill="${set.background}"/>`,
    `  <g clip-path="url(#bbox)">`,
    ...groups,
    `  </g>`,
    `</svg>`,
  ].join("\n");
}

export function downloadSvg(svg: string, filename: string): void {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  downloadBlob(blob, filename);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
