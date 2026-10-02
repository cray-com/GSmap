import { describe, expect, it } from "vitest";
import { crc32, getPngSize, MAX_PNG_PIXELS, pngLayout, pngSelection, PRINT_SIZES, setPngDpi, validateDpi, validatePngSize } from "./pngExport";

const bbox = { west: 16.31, east: 16.43, south: 48.18, north: 48.24 };
const viewport = { width: 900, height: 700 };
const png = new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64")], { type: "image/png" });

async function chunks(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const result: { type: string; data: Uint8Array; crc: number }[] = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = view.getUint32(offset);
    result.push({ type: String.fromCharCode(...bytes.slice(offset + 4, offset + 8)), data: bytes.slice(offset + 8, offset + 8 + length), crc: view.getUint32(offset + 8 + length) });
    offset += length + 12;
  }
  return result;
}

describe("PNG sizing", () => {
  it("frames CSS logical pixels independently of DPR and scales the render dimensions", () => {
    const one = getPngSize(bbox, viewport, 1);
    const four = getPngSize(bbox, viewport, 4);
    expect(one.width).toBe(820);
    expect(one.height).toBeLessThanOrEqual(620);
    expect(Math.abs(four.width - one.width * 4)).toBeLessThanOrEqual(2);
    expect(Math.abs(four.height - one.height * 4)).toBeLessThanOrEqual(2);
    expect(one.width / one.height).toBeCloseTo(pngSelection(bbox).aspect, 2);
    expect(pngLayout(bbox, four).zoom - pngLayout(bbox, one).zoom).toBeCloseTo(2, 2);
  });

  it("centers matching-aspect map pixels on exact A4/A3 pages without stretching", () => {
    expect(PRINT_SIZES.a4).toEqual({ width: 2480, height: 3508 });
    expect(PRINT_SIZES.a3).toEqual({ width: 3508, height: 4961 });
    for (const size of Object.values(PRINT_SIZES)) {
      const layout = pngLayout(bbox, size);
      expect(layout.width).toBe(size.width);
      expect(layout.height).toBeLessThan(size.height);
      expect(layout.x).toBe(0);
      expect(Math.abs(layout.y * 2 + layout.height - size.height)).toBeLessThanOrEqual(1);
      expect(layout.width / layout.height).toBeCloseTo(pngSelection(bbox).aspect, 2);
    }
    const tall = pngLayout({ west: 0, east: 0.01, south: 0, north: 1 }, { width: 1000, height: 500 });
    expect(tall.x).toBeGreaterThan(0);
    expect(tall.height).toBe(500);
  });

  it("uses Mercator latitude spacing, including wrapped longitude selections", () => {
    const equator = pngSelection({ west: 0, east: 1, south: 0, north: 1 });
    const high = pngSelection({ west: 180, east: 181, south: 60, north: 61 });
    expect(high.aspect).toBeLessThan(equator.aspect * 0.51);
    expect(high.center[0]).toBe(180.5);
    expect(high.center[1]).toBeGreaterThan(60.5);
  });

  it("rejects unsafe sizes, degenerate/polar bounds, invalid scales, and unsupported zoom", () => {
    expect(validatePngSize({ width: 8000, height: 4000 }).width * 4000).toBe(MAX_PNG_PIXELS);
    for (const size of [{ width: 8001, height: 4000 }, { width: 0, height: 1 }, { width: 1.5, height: 1 }, { width: Infinity, height: 1 }]) {
      expect(() => validatePngSize(size)).toThrow();
    }
    for (const bounds of [{ ...bbox, east: bbox.west }, { ...bbox, south: 90 }, { ...bbox, north: NaN }, { ...bbox, west: -180, east: 181 }]) {
      expect(() => pngSelection(bounds)).toThrow();
    }
    expect(() => getPngSize(bbox, { width: 80, height: 700 }, 1)).toThrow("viewport");
    expect(() => getPngSize(bbox, viewport, 5 as 1)).toThrow("scale");
    expect(() => pngLayout({ west: 0, east: 1e-10, south: 0, north: 1e-10 }, PRINT_SIZES.a3)).toThrow("zoom limits");
  });
});

describe("PNG DPI metadata", () => {
  it("writes genuine 300 DPI pHYs with a known CRC before IDAT, preserving image data", async () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const original = await chunks(png);
    const result = await chunks(await setPngDpi(png, 300));
    const phys = result.find((chunk) => chunk.type === "pHYs")!;
    const view = new DataView(phys.data.buffer);
    expect(view.getUint32(0)).toBe(11811);
    expect(view.getUint32(4)).toBe(11811);
    expect(phys.data[8]).toBe(1);
    expect(phys.crc).toBe(0x78a53f76);
    expect(result.findIndex((chunk) => chunk.type === "pHYs")).toBeLessThan(result.findIndex((chunk) => chunk.type === "IDAT"));
    expect(result.filter((chunk) => chunk.type !== "pHYs")).toEqual(original);
  });

  it("replaces existing metadata rather than appending contradictory resolutions", async () => {
    const result = await chunks(await setPngDpi(await setPngDpi(png, 96), 300));
    expect(result.filter((chunk) => chunk.type === "pHYs")).toHaveLength(1);
    expect(new DataView(result.find((chunk) => chunk.type === "pHYs")!.data.buffer).getUint32(0)).toBe(11811);
  });

  it("rejects invalid resolution and malformed/truncated PNG data", async () => {
    for (const dpi of [0, -1, NaN, Infinity, 1e20]) expect(() => validateDpi(dpi)).toThrow("DPI");
    await expect(setPngDpi(new Blob(["not PNG"]), 300)).rejects.toThrow("invalid data");
    await expect(setPngDpi(png.slice(0, 35), 300)).rejects.toThrow("truncated");
    await expect(setPngDpi(png.slice(0, 33), 300)).rejects.toThrow("incomplete");
  });
});
