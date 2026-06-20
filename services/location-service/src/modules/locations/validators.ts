import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

export const createLocationBody = z.object({
  name: z.string().min(1).max(200),
  addressLine: z.string().min(1).max(500).optional(),
  city: z.string().min(1).max(120).optional(),
  postalCode: z.string().min(1).max(16).optional(),
});
export type CreateLocationBody = z.infer<typeof createLocationBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const locationViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  addressLine: z.string().nullable(),
  city: z.string().nullable(),
  postalCode: z.string().nullable(),
  status: z.string(),
  version: z.number().int(),
});

export const locationsListSchema = paginatedSchema(locationViewSchema);
