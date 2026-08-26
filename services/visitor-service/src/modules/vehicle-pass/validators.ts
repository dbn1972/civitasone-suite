/**
 * visitor-service: vehicle-pass zod validators (routes.ts boundary).
 *
 * Matches the shape of `VehiclePassCreateInput` in `./commands.ts` exactly,
 * following the convention from `modules/blacklist/validators.ts`.
 */
import { z } from "zod";

// Indian vehicle registration plate, e.g. "MH01AB1234" or "DL-01-AB-1234":
// 2-letter state code, 1-2 digit RTO code, 1-3 letter series, 4-digit number.
// Separators (space/hyphen) between groups are optional and case is
// insensitive. Deliberately not BH-series/defense/diplomatic-format aware —
// this is "reasonable format validation" against garbage input (empty
// strings, punctuation, whitespace), not a full RTO-format authority.
const INDIA_VEHICLE_PLATE_REGEX = /^[A-Z]{2}[\s-]?[0-9]{1,2}[\s-]?[A-Z]{1,3}[\s-]?[0-9]{4}$/i;

export const vehiclePassCreateBody = z.object({
  passId: z.string().uuid("invalid passId"),
  locationId: z.string().uuid("invalid locationId"),
  registrationNumber: z
    .string()
    .min(1, "registrationNumber is required")
    .max(20, "registrationNumber must be 20 characters or fewer")
    .regex(
      INDIA_VEHICLE_PLATE_REGEX,
      "registrationNumber must be a valid Indian vehicle registration number (e.g. MH01AB1234)",
    )
    // Canonicalize AFTER the format checks above pass. The regex already
    // accepts case-insensitive input and an optional [\s-] separator
    // between groups, but without this transform "MH01AB1234" and
    // "mh 01 ab 1234" — the same physical plate, entered slightly
    // differently by two different guards — validate as two DISTINCT
    // strings. Every downstream consumer (routes.ts → commands.ts →
    // consumer.ts's duplicate-active-plate pre-check → the migrations/0015
    // partial unique index) compares/stores whatever comes out of this
    // schema, so without normalizing here both variants would persist as
    // separate 'active' rows — defeating duplicate-plate detection under
    // ordinary manual-entry variance, not just deliberate abuse. This is
    // the sole write path into visitor.vehicle_passes.registration_number
    // (verified by repo-wide grep — no other INSERT/UPDATE touches that
    // column), so normalizing here alone is sufficient; see consumer.ts's
    // pre-check comment for why the DB index wasn't also changed to match.
    .transform((v) => v.toUpperCase().replace(/[\s-]/g, "")),
  vehicleType: z.enum(["two_wheeler", "car", "suv", "bus", "truck"], {
    errorMap: () => ({ message: "vehicleType must be one of: two_wheeler, car, suv, bus, truck" }),
  }),
  visitorCategory: z.enum(["vip", "standard", "handicapped"], {
    errorMap: () => ({ message: "visitorCategory must be one of: vip, standard, handicapped" }),
  }),
  driverName: z.string().max(200, "driverName must be 200 characters or fewer").nullable().optional(),
});
export type VehiclePassCreateBody = z.infer<typeof vehiclePassCreateBody>;
