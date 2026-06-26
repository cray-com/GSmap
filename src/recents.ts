import type { BBox } from "./types";

const KEY = "gsmap-recents";
const MAX = 5;

export type RecentLocation = {
  label: string;
  lat: number;
  lon: number;
  savedAt: number;
  kind: "selection" | "search" | "coordinates";
  bbox?: BBox;
};

type RecentInput = Omit<RecentLocation, "savedAt">;

export function loadRecents(): RecentLocation[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentLocation[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

// Two entries refer to the same place when their coordinates are within this
// tolerance (~1m). The label is intentionally ignored so the same location
// searched or selected again does not create a duplicate entry.
const SAME_LOCATION_EPS = 1e-5;

function locationsMatch(a: RecentLocation, b: RecentInput): boolean {
  return (
    Math.abs(a.lat - b.lat) < SAME_LOCATION_EPS &&
    Math.abs(a.lon - b.lon) < SAME_LOCATION_EPS
  );
}

export function pushRecent(
  current: RecentLocation[],
  entry: RecentInput,
): RecentLocation[] {
  const next: RecentLocation = {
    ...entry,
    savedAt: Date.now(),
  };
  const deduped = current.filter((r) => !locationsMatch(r, entry));
  const updated = [next, ...deduped].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(updated));
  } catch {
    // localStorage full or disabled - silently ignore
  }
  return updated;
}

export function clearRecents(): RecentLocation[] {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  return [];
}

export function formatCoords(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export function centerOfBbox(b: BBox): { lat: number; lon: number } {
  return {
    lat: (b.north + b.south) / 2,
    lon: (b.east + b.west) / 2,
  };
}

export function formatBbox(b: BBox): string {
  const center = centerOfBbox(b);
  return formatCoords(center.lat, center.lon);
}

export function formatRecentCopyText(item: RecentLocation): string {
  return `${item.label} - ${formatCoords(item.lat, item.lon)}`;
}
