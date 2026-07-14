import { z } from "zod";
import { NAMESPACE_PATTERN, KEY_PATTERN } from "./domain.js";

export const configIdParam = z.object({ id: z.string().uuid() });
export const namespaceParam = z.object({ namespace: z.string() });

/**
 * Set (create or version-guarded update) a config entry. `value` is arbitrary
 * JSON but MUST be present (a config entry always carries a value).
 * `expectedVersion` absent = create/first write; present = optimistic-lock guard
 * on an update. Mirrors court/visitor.
 */
export const setConfigBody = z.object({
  namespace:       z.string().trim().regex(NAMESPACE_PATTERN, "invalid namespace"),
  configKey:       z.string().trim().regex(KEY_PATTERN, "invalid configKey"),
  value:           z.any().refine((v) => v !== undefined, { message: "value is required" }),
  label:           z.string().trim().max(200).optional(),
  description:     z.string().trim().max(2000).optional(),
  sortOrder:       z.coerce.number().int().optional(),
  effectiveFrom:   z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "effectiveFrom must be YYYY-MM-DD").optional(),
  effectiveTo:     z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "effectiveTo must be YYYY-MM-DD").optional(),
  expectedVersion: z.coerce.number().int().min(1).optional(),
});
export type SetConfigBody = z.infer<typeof setConfigBody>;

/** Deactivate (soft-retire) a config entry. `expectedVersion` optimistic lock. */
export const deactivateConfigBody = z.object({
  expectedVersion: z.coerce.number().int().min(1),
});
export type DeactivateConfigBody = z.infer<typeof deactivateConfigBody>;
