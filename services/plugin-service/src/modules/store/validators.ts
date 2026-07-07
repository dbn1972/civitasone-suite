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

export const storeValueBody = z.object({
  value: z.unknown(),
});
export type StoreValueBody = z.infer<typeof storeValueBody>;

export const storeEntryResponse = z.object({
  key: z.string(),
  value: z.unknown(),
  sizeBytes: z.number().int(),
  updatedAt: z.string(),
});
export type StoreEntryResponse = z.infer<typeof storeEntryResponse>;
