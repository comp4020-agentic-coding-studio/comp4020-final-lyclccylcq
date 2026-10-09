import { bad } from "./errors.ts";

export type LatLng = { lat: number; lng: number };

const R = 6371.0088; // mean Earth radius, km

// Great-circle distance. Recommendations are ranked by this, never by
// matching city names, so a traveller just over a city boundary still sees
// that city's itineraries.
export function haversineKm(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function parseLatLng(lat: unknown, lng: unknown): LatLng {
  const la = typeof lat === "string" && lat.trim() !== "" ? Number(lat) : typeof lat === "number" ? lat : NaN;
  const ln = typeof lng === "string" && lng.trim() !== "" ? Number(lng) : typeof lng === "number" ? lng : NaN;
  if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) {
    throw bad("Coordinates must be a latitude between -90 and 90 and a longitude between -180 and 180.");
  }
  return { lat: la, lng: ln };
}

export function parseBounded(v: unknown, field: string, min: number, max: number, fallback: number): number {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`${field} must be between ${min} and ${max}.`);
  return n;
}

// About a kilometre: enough to say where someone is roughly, not exactly.
export const coarse = (p: LatLng): LatLng => ({ lat: Math.round(p.lat * 100) / 100, lng: Math.round(p.lng * 100) / 100 });
