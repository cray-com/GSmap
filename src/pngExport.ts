import type { BBox } from "./types";

export type PngSize = { width: number; height: number };
export type PngExportOptions = 1 | 2 | 3 | 4 | (PngSize & { dpi?: number });
export const PRINT_SIZES = {
  a4: { width: 2480, height: 3508 },
  a3: { width: 3508, height: 4961 },
} as const;
export const MAX_PNG_PIXELS = 32_000_000;
const MERCATOR_LIMIT = 85.0511287798066;

export function validatePngSize(size: PngSize): PngSize {
  if (![size.width, size.height].every((n) => Number.isSafeInteger(n) && n > 0)) {
    throw new Error("PNG width and height must be positive whole pixels.");
  }
  if (size.width < 256 || size.height < 64) {
    throw new Error("PNG must be at least 256 × 64 pixels to include readable attribution.");
  }
  if (size.width * size.height > MAX_PNG_PIXELS) {
    throw new Error("PNG is too large (maximum 32 million pixels). Choose a smaller size.");
  }
  return { width: size.width, height: size.height };
}

function mercatorY(lat: number): number {
  return (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
}

export function pngSelection(bbox: BBox) {
  const { west, east, south, north } = bbox;
  if (![west, east, south, north].every(Number.isFinite) || west >= east || south >= north ||
      east - west > 360 || south < -MERCATOR_LIMIT || north > MERCATOR_LIMIT) {
    throw new Error("PNG selection must have nonzero bounds within the Mercator latitude range (±85.0511°).");
  }
  const dx = (east - west) / 360;
  const top = mercatorY(north);
  const bottom = mercatorY(south);
  const dy = bottom - top;
  if (!(dy > 0)) throw new Error("PNG selection is too small to render.");
  return {
    dx, dy, aspect: dx / dy,
    center: [(west + east) / 2, Math.atan(Math.sinh(Math.PI * (1 - top - bottom))) * 180 / Math.PI] as [number, number],
  };
}

/** CSS logical selection fitted with the same 40px framing margin as the preview, independent of DPR. */
export function getPngSize(bbox: BBox, viewport: PngSize, scale: 1 | 2 | 3 | 4): PngSize {
  if (![1, 2, 3, 4].includes(scale)) throw new Error("PNG scale must be 1, 2, 3 or 4.");
  if (![viewport.width, viewport.height].every((n) => Number.isFinite(n) && n > 80)) {
    throw new Error("Map viewport is too small for PNG export.");
  }
  const { dx, dy } = pngSelection(bbox);
  const factor = Math.min((viewport.width - 80) / dx, (viewport.height - 80) / dy);
  return validatePngSize({ width: Math.max(1, Math.round(dx * factor)) * scale, height: Math.max(1, Math.round(dy * factor)) * scale });
}

/** Render at native density; center the resulting pixels without stretching a print page. */
export function pngLayout(bbox: BBox, size: PngSize, pixelRatio = 1) {
  validatePngSize(size);
  if (!Number.isFinite(pixelRatio) || pixelRatio <= 0 || size.width < pixelRatio || size.height < pixelRatio) {
    throw new Error("PNG size is too small for the requested pixel density.");
  }
  const selection = pngSelection(bbox);
  const factor = Math.min(Math.floor(size.width / pixelRatio) / selection.dx, Math.floor(size.height / pixelRatio) / selection.dy);
  const width = Math.max(1, Math.floor(selection.dx * factor + 1e-7));
  const height = Math.max(1, Math.floor(selection.dy * factor + 1e-7));
  const zoom = Math.log2(Math.min(width / selection.dx, height / selection.dy) / 512);
  if (zoom < -2 || zoom > 24) throw new Error("Selection cannot be rendered at this size within MapLibre's zoom limits. Change the size or selection.");
  const renderWidth = Math.floor(width * pixelRatio);
  const renderHeight = Math.floor(height * pixelRatio);
  return { width, height, renderWidth, renderHeight,
    x: Math.floor((size.width - renderWidth) / 2), y: Math.floor((size.height - renderHeight) / 2),
    center: selection.center, zoom };

}

export function validateDpi(dpi: number): number {
  const ppm = Math.round(dpi / 0.0254);
  if (!Number.isFinite(dpi) || dpi <= 0 || ppm < 1 || ppm > 0xffffffff) {
    throw new Error("PNG DPI must be a positive, representable resolution.");
  }
  return ppm;
}

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Replace any existing pHYs with real pixels-per-metre metadata, before IDAT. */
export async function setPngDpi(blob: Blob, dpi: number): Promise<Blob> {
  const ppm = validateDpi(dpi);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((byte, i) => bytes[i] === byte)) throw new Error("PNG encoding returned invalid data.");
  const chunk = new Uint8Array(21);
  const data = new DataView(chunk.buffer);
  data.setUint32(0, 9);
  chunk.set([112, 72, 89, 115], 4); // pHYs
  data.setUint32(8, ppm);
  data.setUint32(12, ppm);
  chunk[16] = 1; // metre
  data.setUint32(17, crc32(chunk.subarray(4, 17)));
  const parts: BlobPart[] = [blob.slice(0, 8)];
  let inserted = false;
  let ended = false;
  for (let offset = 8; offset < bytes.length;) {
    if (offset + 12 > bytes.length) throw new Error("PNG encoding returned a truncated chunk.");
    const end = offset + view.getUint32(offset) + 12;
    if (end > bytes.length) throw new Error("PNG encoding returned a truncated chunk.");
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (offset === 8 && (type !== "IHDR" || view.getUint32(offset) !== 13)) throw new Error("PNG encoding has no valid header.");
    if (type === "IDAT" && !inserted) { parts.push(chunk); inserted = true; }
    if (type !== "pHYs") parts.push(blob.slice(offset, end));
    if (type === "IEND") { ended = true; break; }
    offset = end;
  }
  if (!inserted || !ended) throw new Error("PNG encoding is incomplete.");
  return new Blob(parts, { type: "image/png" });
}
