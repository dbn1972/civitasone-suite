/**
 * Client-side mirror of POST /v1/hrms/office-locations' own zod schema
 * (services/hrms-service geo-attendance routes): name >= 1 char, numeric
 * latitude/longitude, integer radiusMeters in 50..5000. Latitude/longitude
 * are additionally range-checked here (the server only requires "a number"):
 * a transposed or mistyped coordinate silently breaks every geofenced
 * check-in, so catching it before submit is strictly safer.
 */
export const RADIUS_MIN_METERS = 50;
export const RADIUS_MAX_METERS = 5000;
export const RADIUS_DEFAULT_METERS = 200;

export type OfficeLocationInput = {
  name: string;
  address: string;
  latitude: string;
  longitude: string;
  radiusMeters: string;
};

export type OfficeLocationField = "name" | "address" | "latitude" | "longitude" | "radiusMeters";

export type OfficeLocationBody = {
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
};

export type ValidationResult =
  | { ok: true; body: OfficeLocationBody }
  | { ok: false; errors: Partial<Record<OfficeLocationField, "required" | "invalid" | "range">> };

function parseCoordinate(raw: string): number | null {
  const s = raw.trim();
  if (s === "" || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function validateOfficeLocation(input: OfficeLocationInput): ValidationResult {
  const errors: Partial<Record<OfficeLocationField, "required" | "invalid" | "range">> = {};
  const name = input.name.trim();
  const address = input.address.trim();
  if (name.length < 1) errors.name = "required";
  else if (name.length > 256) errors.name = "invalid";
  if (address.length > 1024) errors.address = "invalid";

  const lat = parseCoordinate(input.latitude);
  if (input.latitude.trim() === "") errors.latitude = "required";
  else if (lat === null) errors.latitude = "invalid";
  else if (lat < -90 || lat > 90) errors.latitude = "range";

  const lng = parseCoordinate(input.longitude);
  if (input.longitude.trim() === "") errors.longitude = "required";
  else if (lng === null) errors.longitude = "invalid";
  else if (lng < -180 || lng > 180) errors.longitude = "range";

  const radiusRaw = input.radiusMeters.trim();
  const radius = Number(radiusRaw);
  if (radiusRaw === "") errors.radiusMeters = "required";
  else if (!/^\d+$/.test(radiusRaw) || !Number.isInteger(radius)) errors.radiusMeters = "invalid";
  else if (radius < RADIUS_MIN_METERS || radius > RADIUS_MAX_METERS) errors.radiusMeters = "range";

  if (Object.keys(errors).length > 0 || lat === null || lng === null) return { ok: false, errors };
  return {
    ok: true,
    body: {
      name,
      ...(address ? { address } : {}),
      latitude: lat,
      longitude: lng,
      radiusMeters: radius,
    },
  };
}

/** OpenStreetMap link so the admin can eyeball the pin before confirming. */
export function mapPreviewUrl(latitude: number, longitude: number): string {
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`;
}
