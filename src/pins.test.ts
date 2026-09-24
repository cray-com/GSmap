import { describe, expect, it } from "vitest";
import { parsePinDocument } from "./pins";

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
});
