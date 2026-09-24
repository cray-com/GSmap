import type { BBox } from "./types";

export type Pin = {
  id?: string;
  lat: number;
  lon: number;
  label?: string;
  properties?: Record<string, unknown>;
};

export type PinFormat = "documented pins" | "GeoJSON FeatureCollection" | "record array";
export type PinMetadata = { format: PinFormat; coordinateFields: string; labelField?: string };
export type PinDocument = { pins: Pin[]; bounds?: BBox };
export type ParsedPinDocument = PinDocument & { metadata: PinMetadata };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function numberField(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number.`);
  return value;
}
function validateCoords(lat: number, lon: number, path: string) {
  if (lat < -90 || lat > 90) throw new Error(`${path}.lat must be between -90 and 90.`);
  if (lon < -180 || lon > 180) throw new Error(`${path}.lon must be between -180 and 180.`);
}
function parseBounds(value: unknown): BBox {
  if (!isRecord(value)) throw new Error("bounds must be an object.");
  const south = numberField(value.south, "bounds.south"), west = numberField(value.west, "bounds.west");
  const north = numberField(value.north, "bounds.north"), east = numberField(value.east, "bounds.east");
  if (south < -90 || south > 90 || north < -90 || north > 90) throw new Error("bounds latitude values must be between -90 and 90.");
  if (west < -180 || west > 180 || east < -180 || east > 180) throw new Error("bounds longitude values must be between -180 and 180.");
  if (south >= north || west >= east) throw new Error("bounds must have south < north and west < east.");
  return { south, west, north, east };
}
function keyMap(record: Record<string, unknown>) {
  return new Map(Object.keys(record).map((key) => [key.toLowerCase(), key]));
}
const PAIRS = [["latitude", "longitude"], ["lat", "lon"], ["lat", "lng"]] as const;
const LABEL_FIELDS = ["label", "name", "title", "project", "location_name", "id"];

function makePin(record: Record<string, unknown>, lat: number, lon: number, path: string): Pin {
  validateCoords(lat, lon, path);
  const keys = keyMap(record);
  const idKey = keys.get("id");
  const labelKey = LABEL_FIELDS.map((f) => keys.get(f)).find((key) => key && (typeof record[key] === "string" || typeof record[key] === "number"));
  const id = idKey && (typeof record[idKey] === "string" || typeof record[idKey] === "number") ? String(record[idKey]) : undefined;
  const label = labelKey ? String(record[labelKey]) : undefined;
  return { ...(id ? { id } : {}), lat, lon, ...(label !== undefined ? { label } : {}), properties: { ...record } };
}

function parseRecords(records: unknown[], pathPrefix: string): { pins: Pin[]; fields: string } {
  let selected: { lat: string; lon: string } | undefined;
  const pins = records.map((raw, index) => {
    const path = `${pathPrefix}[${index}]`;
    if (!isRecord(raw)) throw new Error(`${path} must be an object.`);
    const keys = keyMap(raw);
    if (!selected) {
      const pair = PAIRS.find(([lat, lon]) => keys.has(lat) && keys.has(lon));
      if (pair) selected = { lat: keys.get(pair[0])!, lon: keys.get(pair[1])! };
    }
    if (!selected) throw new Error("Could not detect coordinates. Supported pairs are latitude/longitude, lat/lon, and lat/lng.");
    return makePin(raw, numberField(raw[selected.lat], `${path}.${selected.lat}`), numberField(raw[selected.lon], `${path}.${selected.lon}`), path);
  });
  return { pins, fields: selected ? `${selected.lat}/${selected.lon}` : "lat/lon" };
}

/** Parse one of the documented, deterministic input adapters. */
export function parsePinInput(input: string): ParsedPinDocument {
  let value: unknown;
  try { value = JSON.parse(input); } catch { throw new Error("The pin data is not valid JSON."); }
  if (isRecord(value) && Array.isArray(value.pins)) {
    const parsed = parseRecords(value.pins, "pins");
    const bounds = value.bounds === undefined ? undefined : parseBounds(value.bounds);
    return { ...(bounds ? { bounds } : {}), pins: parsed.pins, metadata: { format: "documented pins", coordinateFields: parsed.fields, labelField: findLabelField(parsed.pins) } };
  }
  if (isRecord(value) && value.type === "FeatureCollection" && Array.isArray(value.features)) {
    const pins = value.features.map((feature, index) => {
      if (!isRecord(feature) || feature.type !== "Feature" || !isRecord(feature.geometry) || feature.geometry.type !== "Point" || !Array.isArray(feature.geometry.coordinates) || feature.geometry.coordinates.length < 2) throw new Error(`features[${index}] must be a GeoJSON Point feature.`);
      const coordinates = feature.geometry.coordinates;
      const properties = isRecord(feature.properties) ? { ...feature.properties } : {};
      if (feature.id !== undefined && properties.id === undefined) properties.id = feature.id;
      return makePin(properties, numberField(coordinates[1], `features[${index}].geometry.coordinates[1]`), numberField(coordinates[0], `features[${index}].geometry.coordinates[0]`), `features[${index}]`);
    });
    return { pins, metadata: { format: "GeoJSON FeatureCollection", coordinateFields: "coordinates[lon, lat]", labelField: findLabelField(pins) } };
  }
  if (Array.isArray(value)) {
    const parsed = parseRecords(value, "records");
    return { pins: parsed.pins, metadata: { format: "record array", coordinateFields: parsed.fields, labelField: findLabelField(parsed.pins) } };
  }
  throw new Error("Supported roots are {pins:[...]}, a GeoJSON FeatureCollection, or an array of records.");
}
function findLabelField(pins: Pin[]): string | undefined {
  const first = pins[0]?.properties;
  if (!first) return undefined;
  const keys = keyMap(first);
  return LABEL_FIELDS.map((field) => keys.get(field)).find((key) => key !== undefined);
}
/** Backwards-compatible documented adapter. */
export function parsePinDocument(input: string): PinDocument {
  let raw: unknown;
  try { raw = JSON.parse(input); } catch { throw new Error("The pin data is not valid JSON."); }
  if (!isRecord(raw) || !Array.isArray(raw.pins)) throw new Error("pins is required and must be an array.");
  const parsed = parsePinInput(input);
  if (parsed.metadata.format !== "documented pins") throw new Error("The JSON root must be an object with pins.");
  const ids = new Set<string>();
  for (const pin of parsed.pins) { if (pin.id && ids.has(pin.id)) throw new Error(`Duplicate pin id "${pin.id}".`); if (pin.id) ids.add(pin.id); }
  return { pins: parsed.pins.map(({ properties: _properties, ...pin }) => pin), ...(parsed.bounds ? { bounds: parsed.bounds } : {}) };
}

export type AggregatedPin = Pin & { duplicateCount: number; duplicateScale: number };
export function aggregatePins(pins: Pin[], maxScale = 3): AggregatedPin[] {
  const groups = new Map<string, Pin[]>();
  for (const pin of pins) { const key = `${pin.lat}\u0000${pin.lon}`; groups.set(key, [...(groups.get(key) ?? []), pin]); }
  return [...groups.values()].map((group) => ({ ...group[0], duplicateCount: group.length, duplicateScale: Math.min(maxScale, Math.sqrt(group.length)) }));
}
