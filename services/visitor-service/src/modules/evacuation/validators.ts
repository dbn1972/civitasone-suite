/**
 * visitor-service: evacuation module zod validators (routes.ts boundary).
 *
 * Matches the shape of `EvacuationDeclareInput` / `EvacuationMarkSafeInput`
 * in `./commands.ts` exactly.
 */
import { z } from "zod";

/** Query params for GET /roster and GET /count — locationId is required
 *  (an evacuation roster is always per-location). tenantId is pulled from
 *  the `x-tenant-id` header (same as resolveContext) even when standard
 *  auth is bypassed. */
export const rosterQuery = z.object({
  locationId: z.string().uuid("invalid locationId"),
});
export type RosterQuery = z.infer<typeof rosterQuery>;

export const evacuationDeclareBody = z.object({
  locationId: z.string().uuid("invalid locationId"),
  reason: z.string().max(2000, "reason must be 2000 characters or fewer").nullable().optional(),
});
export type EvacuationDeclareBody = z.infer<typeof evacuationDeclareBody>;

export const evacuationMarkSafeBody = z.object({
  locationId: z.string().uuid("invalid locationId"),
  passId: z.string().uuid("invalid passId"),
});
export type EvacuationMarkSafeBody = z.infer<typeof evacuationMarkSafeBody>;
