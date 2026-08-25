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
    ),
  vehicleType: z.enum(["two_wheeler", "car", "suv", "bus", "truck"], {
    errorMap: () => ({ message: "vehicleType must be one of: two_wheeler, car, suv, bus, truck" }),
  }),
  visitorCategory: z.enum(["vip", "standard", "handicapped"], {
    errorMap: () => ({ message: "visitorCategory must be one of: vip, standard, handicapped" }),
  }),
  driverName: z.string().max(200, "driverName must be 200 characters or fewer").nullable().optional(),
});
export type VehiclePassCreateBody = z.infer<typeof vehiclePassCreateBody>;
