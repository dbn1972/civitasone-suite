import { z } from "zod";

export const geoTagBody = z.object({
  lat:           z.number().min(-90).max(90),
  lon:           z.number().min(-180).max(180),
  locationName:  z.string().max(255).optional(),
  description:   z.string().max(1000).optional(),
});
export type GeoTagBody = z.infer<typeof geoTagBody>;

export const photoUploadBody = z.object({
  geoTagId:      z.string().uuid().optional(),
  originalName:  z.string().min(1).max(255),
  description:   z.string().max(500).optional(),
  contentType:   z.string().default("image/jpeg"),
});
export type PhotoUploadBody = z.infer<typeof photoUploadBody>;

export const idParam = z.object({ id: z.string().uuid() });
