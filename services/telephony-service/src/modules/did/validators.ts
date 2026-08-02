/** zod validators for the DID mappings module. */
import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

export const createDidMappingBody = z.object({
  didNumber: z.string().min(1).max(32).regex(/^\+?[\d\s\-()]+$/, "must be a valid phone number"),
  label: z.string().max(160).optional(),
  active: z.boolean().default(true),
});
export type CreateDidMappingBody = z.infer<typeof createDidMappingBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const didMappingViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  didNumber: z.string(),
  label: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string(),
  version: z.number().int(),
});

export const didMappingsListSchema = paginatedSchema(didMappingViewSchema);

export const createDidMappingPayload = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  didNumber: z.string().min(1).max(32),
  label: z.string().max(160).nullable(),
  active: z.boolean(),
});
export type CreateDidMappingPayload = z.infer<typeof createDidMappingPayload>;

export const deleteDidMappingPayload = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
});
export type DeleteDidMappingPayload = z.infer<typeof deleteDidMappingPayload>;
