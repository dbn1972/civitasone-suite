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

export const idParam = z.object({ id: z.string().uuid("invalid id") });

export const createLocationBody = z.object({
  name: z.string().min(1, "name is required").max(200, "name must be 200 characters or fewer"),
  address: z.string().max(2000, "address must be 2000 characters or fewer").optional(),
  businessHours: businessHoursSchema,
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
