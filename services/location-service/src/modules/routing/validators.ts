import { z } from "zod";

/**
 * Waypoint schema — a single lat/lng point.
 */
export const waypointSchema = z.object({
  lat: z
    .number()
    .min(-90, "Latitude must be between -90 and 90")
    .max(90, "Latitude must be between -90 and 90"),
  lng: z
    .number()
    .min(-180, "Longitude must be between -180 and 180")
    .max(180, "Longitude must be between -180 and 180"),
});

/**
 * Request body for POST /v1/locations/routing
 *
 * Accepts an array of 2–25 waypoints.
 */
export const routingBody = z.object({
  waypoints: z
    .array(waypointSchema)
    .min(2, "At least 2 waypoints are required")
    .max(25, "Maximum 25 waypoints allowed"),
});

export type RoutingBody = z.infer<typeof routingBody>;
