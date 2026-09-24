import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { aggregatePins, boundsFromPins, isPinFileName, parsePinDocument, parsePinInput } from "./pins";
import {
  DEFAULT_PIN_CSS,
  DEFAULT_PIN_TEMPLATE,
  escapeHtml,
  renderPinTemplate,
  sanitizePinCss,
  sanitizePinTemplate,
} from "./pinTemplate";

describe("parsePinDocument", () => {
  it("recognizes ordinary JSON upload filenames", () => {
    expect(isPinFileName("locations.json")).toBe(true);
    expect(isPinFileName("locations.geojson")).toBe(true);
    expect(isPinFileName("locations.txt")).toBe(false);
  });

  it("parses pins and optional bounds", () => {
    expect(parsePinDocument(JSON.stringify({
      bounds: { south: 1, west: 2, north: 3, east: 4 },
      pins: [{ id: "a", lat: 2, lon: 3, label: "A" }, { lat: 2.5, lon: 3.5 }],
    }))).toEqual({
      bounds: { south: 1, west: 2, north: 3, east: 4 },
      pins: [{ id: "a", lat: 2, lon: 3, label: "A" }, { lat: 2.5, lon: 3.5 }],
    });
  });

  it("requires pins and validates coordinates", () => {
    expect(() => parsePinDocument("{}"))
      .toThrow("pins is required and must be an array");
    expect(() => parsePinDocument('{"pins":[{"lat":91,"lon":0}]}'))
      .toThrow("pins[0].lat must be between -90 and 90");
  });

  it("rejects duplicate ids and invalid bounds", () => {
    expect(() => parsePinDocument('{"pins":[{"id":"x","lat":0,"lon":0},{"id":"x","lat":1,"lon":1}]}'))
      .toThrow('Duplicate pin id "x"');
    expect(() => parsePinDocument('{"bounds":{"south":2,"west":0,"north":1,"east":1},"pins":[]}'))
      .toThrow("bounds must have south < north and west < east");
  });

  it("reports malformed JSON clearly", () => {
    expect(() => parsePinDocument("not json")).toThrow("not valid JSON");
  });

  it("detects record arrays case-insensitively and chooses labels predictably", () => {
    const parsed = parsePinInput('[{"LATITUDE":1,"LONGITUDE":2,"name":"N","project":"P"}]');
    expect(parsed.metadata).toMatchObject({ format: "record array", coordinateFields: "LATITUDE/LONGITUDE", labelField: "name" });
    expect(parsed.pins[0].label).toBe("N");
    expect(parsed.pins[0].properties?.project).toBe("P");
  });

  it("imports representative JSON and GeoJSON fixtures", () => {
    const json = readFileSync(new URL("./fixtures/sample.json", import.meta.url), "utf8");
    const geojson = readFileSync(new URL("./fixtures/sample.geojson", import.meta.url), "utf8");
    expect(parsePinInput(json).pins.length).toBe(2);
    expect(parsePinInput(geojson).pins.length).toBe(2);
  });

  it("detects GeoJSON points with lon/lat order", () => {
    const parsed = parsePinInput(JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { title: "X" }, geometry: { type: "Point", coordinates: [2, 1] } }] }));
    expect(parsed.metadata.format).toBe("GeoJSON FeatureCollection");
    expect(parsed.pins[0]).toMatchObject({ lat: 1, lon: 2, label: "X" });
  });

  it("computes padded bounds for imported pins", () => {
    expect(boundsFromPins([{ lat: 10, lon: 20 }, { lat: 12, lon: 24 }])).toEqual({ south: 9.6, west: 19.2, north: 12.4, east: 24.8 });
    expect(boundsFromPins([{ lat: 10, lon: 20 }])).toEqual({ south: 9.99, west: 19.99, north: 10.01, east: 20.01 });
  });

  it("aggregates exact duplicates with square-root scaling", () => {
    const pins = parsePinInput('[{"lat":1,"lon":2},{"lat":1,"lon":2},{"lat":1,"lon":2},{"lat":3,"lon":4}]').pins;
    expect(aggregatePins(pins)).toMatchObject([{ lat: 1, lon: 2, duplicateCount: 3, duplicateScale: Math.sqrt(3) }, { lat: 3, lon: 4, duplicateCount: 1, duplicateScale: 1 }]);
  });

  it("accepts the default template and CSS", () => {
    expect(() => sanitizePinTemplate(DEFAULT_PIN_TEMPLATE)).not.toThrow();
    expect(() => sanitizePinCss(DEFAULT_PIN_CSS)).not.toThrow();
    expect(() => sanitizePinCss(
      ".pin { display: flex; gap: 4px; padding: 6px 9px; } .pin-label { transform: translateY(1px); }",
    )).not.toThrow();
  });

  it("escapes template values and rejects active or remote content", () => {
    expect(escapeHtml('<x>&')).toBe("&lt;x&gt;&amp;");
    expect(renderPinTemplate("<div>{{label}}</div>", { label: "<script>" }))
      .toBe("<div>&lt;script&gt;</div>");
    expect(() => sanitizePinTemplate('<img src="https://example.test/x">')).toThrow();
    expect(() => sanitizePinCss('@import url(https://example.test/x);')).toThrow();
  });
});
