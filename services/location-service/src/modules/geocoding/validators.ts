import { z } from "zod";

/**
 * Request body for POST /v1/locations/geocode
 *
 * Accepts either:
 *  - { address: string }  → forward geocode
 *  - { lat: number, lng: number } → reverse geocode
 */
export const geocodeBody = z.union([
  z.object({
    address: z.string().min(1, "Address is required").max(500, "Address must be 500 characters or fewer"),
  }),
  z.object({
    lat: z.number().min(-90, "Latitude must be between -90 and 90").max(90, "Latitude must be between -90 and 90"),
    lng: z.number().min(-180, "Longitude must be between -180 and 180").max(180, "Longitude must be between -180 and 180"),
  }),
]);

export type GeocodeBody = z.infer<typeof geocodeBody>;
