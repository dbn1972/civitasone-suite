/**
 * Plugin Store Route Validators
 *
 * Zod schemas for request validation on plugin store routes.
 */

import { z } from "zod";

export const storeKeyParams = z.object({
  pluginId: z.string().uuid(),
  key: z.string().min(1).max(256),
});
export type StoreKeyParams = z.infer<typeof storeKeyParams>;

// UAT W8-C: z.unknown() also accepts a MISSING value, and JSON.stringify(undefined) is undefined, so
// computeValueSize() threw a TypeError (500) on PUT {} . A value is required; JSON null is still allowed.
export const storeValueBody = z.object({
  value: z.unknown().refine((v) => v !== undefined, { message: "value is required" }),
});
export type StoreValueBody = z.infer<typeof storeValueBody>;

export const storeEntryResponse = z.object({
  key: z.string(),
  value: z.unknown(),
  sizeBytes: z.number().int(),
  updatedAt: z.string(),
});
export type StoreEntryResponse = z.infer<typeof storeEntryResponse>;
