import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { aggregatePins, parsePinDocument, parsePinInput } from "./pins";
import { escapeHtml, sanitizePinCss, sanitizePinTemplate } from "./pinTemplate";

describe("parsePinDocument", () => {
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

  it("imports both supplied GSmap2 fixtures", () => {
    const json = readFileSync("/home/rasputin/Shared/GSmap2/create-graffiti-dataset.json", "utf8");
    const geojson = readFileSync("/home/rasputin/Shared/GSmap2/create-graffiti-dataset.geojson", "utf8");
    expect(parsePinInput(json).pins.length).toBeGreaterThan(0);
    expect(parsePinInput(geojson).pins.length).toBeGreaterThan(0);
  });

  it("detects GeoJSON points with lon/lat order", () => {
    const parsed = parsePinInput(JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { title: "X" }, geometry: { type: "Point", coordinates: [2, 1] } }] }));
    expect(parsed.metadata.format).toBe("GeoJSON FeatureCollection");
    expect(parsed.pins[0]).toMatchObject({ lat: 1, lon: 2, label: "X" });
  });

  it("aggregates exact duplicates with square-root scaling", () => {
    const pins = parsePinInput('[{"lat":1,"lon":2},{"lat":1,"lon":2},{"lat":1,"lon":2},{"lat":3,"lon":4}]').pins;
    expect(aggregatePins(pins)).toMatchObject([{ lat: 1, lon: 2, duplicateCount: 3, duplicateScale: Math.sqrt(3) }, { lat: 3, lon: 4, duplicateCount: 1, duplicateScale: 1 }]);
  });

  it("escapes template values and rejects active or remote content", () => {
    expect(escapeHtml('<x>&')).toBe("&lt;x&gt;&amp;");
    expect(() => sanitizePinTemplate('<img src="https://example.test/x">')).toThrow();
    expect(() => sanitizePinCss('@import url(https://example.test/x);')).toThrow();
  });
});
