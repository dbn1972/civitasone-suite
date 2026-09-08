import { z } from "zod";
import { safeText } from "../../shared/sanitize.js";

export const idParam = z.object({ id: z.string().uuid() });

export const REQUEST_STATUSES = [
  "submitted", "under_review", "in_progress", "resolved", "rejected", "cancelled",
] as const;

/** Statuses a bare citizen may set on their own request via PATCH (self-service withdrawal only). */
export const CITIZEN_SETTABLE_STATUSES = new Set<string>(["cancelled"]);

/**
 * The only updateRequestBody keys a bare (non-officer) citizen may ever supply
 * via PATCH /v1/citizen/requests/:id -- assigneeDepartment (officer-only
 * department-routing metadata) and note (an officer annotation attached to a
 * status transition) are excluded. Enforced by checking every key actually
 * present in the parsed body, not by gating on `status` alone -- a body that
 * omits `status` entirely (e.g. { assigneeDepartment: "..." }) must still be
 * rejected for a non-officer caller.
 */
export const CITIZEN_ALLOWED_UPDATE_KEYS = new Set<string>(["status"]);

export const createRequestBody = z.object({
  /** P0-3: officer-tier may log a request on behalf of a given citizenId; a bare
   * citizen's id is forced to their own actorId at the route. */
  citizenId:   z.string().uuid().optional(),
  category:    safeText({ max: 64 }).optional(),
  subject:     safeText({ max: 200 }),
  description: safeText({ max: 4000, multiline: true }),
  channel:     z.enum(["portal", "mobile", "counter", "assisted"]).optional(),
});
export type CreateRequestBody = z.infer<typeof createRequestBody>;

export const updateRequestBody = z.object({
  status:              z.enum(REQUEST_STATUSES).optional(),
  note:                safeText({ max: 1000, multiline: true }).optional(),
  assigneeDepartment:  safeText({ max: 128 }).optional(),
}).refine((b) => b.status !== undefined || b.note !== undefined || b.assigneeDepartment !== undefined, {
  message: "at least one of status, note, assigneeDepartment is required",
});
export type UpdateRequestBody = z.infer<typeof updateRequestBody>;

export const listQuerySchema = z.object({
  limit:  z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(REQUEST_STATUSES).optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;
