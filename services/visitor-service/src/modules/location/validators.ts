import { z } from "zod";

/** A single day's open/close window, or null if the location has no entry for that day. */
const businessHoursDayEntry = z
  .object({
    open: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "open must be HH:MM (24-hour)"),
    close: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "close must be HH:MM (24-hour)"),
    closed: z.boolean().optional(),
  })
  .nullable();

/** Matches the `BusinessHours` type in `./schema.ts` (one entry per day of week). */
export const businessHoursSchema = z.object({
  mon: businessHoursDayEntry,
  tue: businessHoursDayEntry,
  wed: businessHoursDayEntry,
  thu: businessHoursDayEntry,
  fri: businessHoursDayEntry,
  sat: businessHoursDayEntry,
  sun: businessHoursDayEntry,
});

/**
 * Fallback applied when a caller omits `businessHours` on location create.
 * The API validator marks the field optional (`createLocationBody` below),
 * but the `locations.business_hours` column is NOT NULL with no DB-level
 * default — omitting it used to reach routes.ts's unsafe
 * `body.businessHours as BusinessHours` cast, which silenced the type
 * mismatch instead of resolving it: the route still returned 202
 * Accepted, but the consumer's insert then failed a NOT NULL constraint
 * and the location silently never existed (confirmed live 2026-08-27).
 * Standard government working week — Mon-Fri 09:00-18:00, Sat/Sun closed
 * — chosen as a reasonable default; callers that need different hours
 * should keep supplying `businessHours` explicitly, as most already do.
 */
export const DEFAULT_BUSINESS_HOURS: z.infer<typeof businessHoursSchema> = {
  mon: { open: "09:00", close: "18:00" },
  tue: { open: "09:00", close: "18:00" },
  wed: { open: "09:00", close: "18:00" },
  thu: { open: "09:00", close: "18:00" },
  fri: { open: "09:00", close: "18:00" },
  sat: null,
  sun: null,
};

export const idParam = z.object({ id: z.string().uuid("invalid id") });

export const createLocationBody = z.object({
  name: z.string().min(1, "name is required").max(200, "name must be 200 characters or fewer"),
  address: z.string().max(2000, "address must be 2000 characters or fewer").optional(),
  businessHours: businessHoursSchema.optional(),
  capacity: z.number().int().positive().max(100_000).optional(),
  capacityThreshold: z.number().int().positive().max(100_000).optional(),
  active: z.boolean().optional(),
});
export type CreateLocationBody = z.infer<typeof createLocationBody>;

export const createAreaBody = z.object({
  name: z.string().min(1, "name is required").max(200, "name must be 200 characters or fewer"),
  securityLevel: z.number().int().min(1).max(5).optional(),
  authorizedApprovers: z.array(z.string().uuid()).optional(),
  escortRequired: z.boolean().optional(),
  active: z.boolean().optional(),
});
export type CreateAreaBody = z.infer<typeof createAreaBody>;
