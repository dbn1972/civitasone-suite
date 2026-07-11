/**
 * visitor-service: visit-request zod validators (routes.ts boundary).
 *
 * Matches the shape of the command inputs `commands.ts` publishes and the
 * required-field set `domain.ts#findMissingRequiredFields` validates
 * downstream, following the same convention as
 * `modules/blacklist/validators.ts` and `modules/location/validators.ts`.
 *
 * NOTE: fine-grained business validation (scheduled-date window via
 * `isValidScheduledDate`, required-field completeness via
 * `findMissingRequiredFields`) is domain.ts's job and is re-checked by the
 * consumer (task 6.11) — the zod schemas below only enforce shape/type at
 * the HTTP boundary (Requirement 1.3/1.5) so obviously malformed requests
 * are rejected before ever reaching the queue.
 */
import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid("invalid id") });

export const createVisitRequestBody = z.object({
  locationId: z.string().uuid("invalid locationId"),
  visitorName: z.string().min(1, "visitorName is required").max(200, "visitorName must be 200 characters or fewer"),
  visitorPhone: z.string().min(1, "visitorPhone is required").max(20, "visitorPhone must be 20 characters or fewer"),
  visitorEmail: z.string().email("invalid visitorEmail").max(200).nullable().optional(),
  purpose: z.string().min(1, "purpose is required").max(2000, "purpose must be 2000 characters or fewer"),
  hostEmployeeId: z.string().uuid("invalid hostEmployeeId"),
  scheduledAt: z.string().datetime({ message: "scheduledAt must be an ISO timestamp" }),
  passType: z.enum(["single", "multi_day", "recurring", "event"]).optional(),
  identityDocType: z.string().max(24, "identityDocType must be 24 characters or fewer").nullable().optional(),
  identityDocRef: z.string().max(128, "identityDocRef must be 128 characters or fewer").nullable().optional(),
  visitorCategory: z.enum(["standard", "vip", "contractor", "delegation"]).optional(),
  source: z.enum(["portal", "host_preregister", "kiosk", "mobile"]).optional(),
  permittedAreas: z.array(z.string().uuid()).optional(),
});
export type CreateVisitRequestBody = z.infer<typeof createVisitRequestBody>;

export const approveVisitRequestBody = z.object({}).optional();
export type ApproveVisitRequestBody = z.infer<typeof approveVisitRequestBody>;

export const rejectVisitRequestBody = z.object({
  reason: z.string().min(1, "reason is required").max(2000, "reason must be 2000 characters or fewer"),
});
export type RejectVisitRequestBody = z.infer<typeof rejectVisitRequestBody>;

export const listVisitRequestsQuery = z.object({
  status: z
    .enum(["pending_approval", "pre_approved", "approved", "rejected", "auto_rejected", "cancelled", "no_show"])
    .optional(),
  locationId: z.string().uuid("invalid locationId").optional(),
  hostEmployeeId: z.string().uuid("invalid hostEmployeeId").optional(),
});
export type ListVisitRequestsQuery = z.infer<typeof listVisitRequestsQuery>;
