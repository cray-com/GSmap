import type { BBox } from "./types";

export type Pin = {
  id?: string;
  lat: number;
  lon: number;
  label?: string;
};

export type PinDocument = {
  pins: Pin[];
  bounds?: BBox;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberField(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
  return value;
}

function parseBounds(value: unknown): BBox {
  if (!isRecord(value)) throw new Error("bounds must be an object.");
  const south = numberField(value.south, "bounds.south");
  const west = numberField(value.west, "bounds.west");
  const north = numberField(value.north, "bounds.north");
  const east = numberField(value.east, "bounds.east");
  if (south < -90 || south > 90 || north < -90 || north > 90) {
    throw new Error("bounds latitude values must be between -90 and 90.");
  }
  if (west < -180 || west > 180 || east < -180 || east > 180) {
    throw new Error("bounds longitude values must be between -180 and 180.");
  }
  if (south >= north || west >= east) {
    throw new Error("bounds must have south < north and west < east.");
  }
  return { south, west, north, east };
}

/** Parse and validate the documented JSON pin object. */
export function parsePinDocument(input: string): PinDocument {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw new Error("The pin data is not valid JSON.");
  }
  if (!isRecord(value)) throw new Error("The JSON root must be an object.");
  if (!Array.isArray(value.pins)) throw new Error("pins is required and must be an array.");

  const bounds = value.bounds === undefined ? undefined : parseBounds(value.bounds);
  const ids = new Set<string>();
  const pins = value.pins.map((raw, index): Pin => {
    const path = `pins[${index}]`;
    if (!isRecord(raw)) throw new Error(`${path} must be an object.`);
    const lat = numberField(raw.lat, `${path}.lat`);
    const lon = numberField(raw.lon, `${path}.lon`);
    if (lat < -90 || lat > 90) throw new Error(`${path}.lat must be between -90 and 90.`);
    if (lon < -180 || lon > 180) throw new Error(`${path}.lon must be between -180 and 180.`);

    let id: string | undefined;
    if (raw.id !== undefined) {
      if (typeof raw.id !== "string" || raw.id.trim() === "") {
        throw new Error(`${path}.id must be a non-empty string.`);
      }
      id = raw.id;
      if (ids.has(id)) throw new Error(`Duplicate pin id "${id}".`);
      ids.add(id);
    }
    let label: string | undefined;
    if (raw.label !== undefined) {
      if (typeof raw.label !== "string") throw new Error(`${path}.label must be a string.`);
      label = raw.label;
    }
    return { ...(id ? { id } : {}), lat, lon, ...(label !== undefined ? { label } : {}) };
  });

  return bounds ? { pins, bounds } : { pins };
}
