import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

export const GEOFENCE_TYPES = ["office", "site", "zone"] as const;

const polygonPoint = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const createGeofenceBody = z.object({
  name: z.string().min(1, "Name is required").max(200, "Name must be 200 characters or fewer"),
  type: z.enum(GEOFENCE_TYPES, { message: "Choose a valid geofence type" }),
  centerLat: z.number().min(-90, "Latitude must be between -90 and 90").max(90, "Latitude must be between -90 and 90"),
  centerLng: z.number().min(-180, "Longitude must be between -180 and 180").max(180, "Longitude must be between -180 and 180"),
  radiusMeters: z.number().int().positive("Radius must be a positive integer"),
  polygon: z.array(polygonPoint).min(3, "Polygon must have at least 3 points").optional(),
  active: z.boolean().default(true),
});
export type CreateGeofenceBody = z.infer<typeof createGeofenceBody>;

export const updateGeofenceBody = z.object({
  name: z.string().min(1).max(200).optional(),
  centerLat: z.number().min(-90).max(90).optional(),
  centerLng: z.number().min(-180).max(180).optional(),
  radiusMeters: z.number().int().positive().optional(),
  polygon: z.array(polygonPoint).min(3).nullable().optional(),
  active: z.boolean().optional(),
});
export type UpdateGeofenceBody = z.infer<typeof updateGeofenceBody>;

export const geofenceCheckBody = z.object({
  lat: z.number().min(-90, "Latitude must be between -90 and 90").max(90, "Latitude must be between -90 and 90"),
  lng: z.number().min(-180, "Longitude must be between -180 and 180").max(180, "Longitude must be between -180 and 180"),
});
export type GeofenceCheckBody = z.infer<typeof geofenceCheckBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const geofenceViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  type: z.enum(GEOFENCE_TYPES),
  centerLat: z.number(),
  centerLng: z.number(),
  radiusMeters: z.number().int(),
  polygon: z.array(polygonPoint).nullable(),
  active: z.boolean(),
  version: z.number().int(),
});

export const geofenceCheckResultSchema = z.object({
  geofenceId: z.string().uuid(),
  inside: z.boolean(),
  distanceMeters: z.number(),
});

export const geofencesListSchema = paginatedSchema(geofenceViewSchema);

/**
 * Haversine formula: distance in meters between two lat/lng points.
 */
export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Ray-casting algorithm: determine if a point is inside a polygon.
 */
export function pointInPolygon(lat: number, lng: number, polygon: Array<{ lat: number; lng: number }>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]!.lat;
    const yi = polygon[i]!.lng;
    const xj = polygon[j]!.lat;
    const yj = polygon[j]!.lng;
    const intersect = yi > lng !== yj > lng && lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
