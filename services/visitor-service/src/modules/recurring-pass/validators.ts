/**
 * visitor-service: recurring-pass zod validators (routes.ts boundary).
 *
 * Matches the shape of `RecurringPassCreateInput` / `RecurringPassSuspendInput` /
 * `RecurringPassRevokeInput` in `./commands.ts`, following the same convention
 * as `modules/blacklist/validators.ts`.
 *
 * Requirement 12.1: recurring pass creation with schedule and max 90-day validity.
 * Requirement 12.4: suspend/revoke with reason for audit trail.
 */
import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid("invalid id") });

export const recurringPassCreateBody = z.object({
  locationId: z.string().uuid("invalid locationId"),
  visitorName: z.string().min(1, "visitorName is required").max(200, "visitorName must be 200 characters or fewer"),
  visitorPhone: z.string().min(1, "visitorPhone is required").max(20, "visitorPhone must be 20 characters or fewer"),
  companyName: z.string().max(200, "companyName must be 200 characters or fewer").nullable().optional(),
  validFrom: z.string().datetime({ message: "validFrom must be an ISO timestamp" }),
  validUntil: z.string().datetime({ message: "validUntil must be an ISO timestamp" }),
  permittedDays: z
    .array(z.number().int().min(0, "day must be 0–6").max(6, "day must be 0–6"))
    .min(1, "permittedDays must contain at least 1 day")
    .max(7, "permittedDays must contain at most 7 days"),
  permittedTimeFrom: z.string().regex(/^\d{2}:\d{2}$/, "permittedTimeFrom must be HH:MM").nullable().optional(),
  permittedTimeTo: z.string().regex(/^\d{2}:\d{2}$/, "permittedTimeTo must be HH:MM").nullable().optional(),
});
export type RecurringPassCreateBody = z.infer<typeof recurringPassCreateBody>;

export const recurringPassSuspendBody = z.object({
  reason: z.string().min(1, "reason is required").max(2000, "reason must be 2000 characters or fewer"),
});
export type RecurringPassSuspendBody = z.infer<typeof recurringPassSuspendBody>;

export const recurringPassRevokeBody = z.object({
  reason: z.string().max(2000, "reason must be 2000 characters or fewer").nullable().optional(),
});
export type RecurringPassRevokeBody = z.infer<typeof recurringPassRevokeBody>;
