/**
 * visitor-service: vehicle-pass zod validators (routes.ts boundary).
 *
 * Matches the shape of `VehiclePassCreateInput` in `./commands.ts` exactly,
 * following the convention from `modules/blacklist/validators.ts`.
 */
import { z } from "zod";

export const vehiclePassCreateBody = z.object({
  passId: z.string().uuid("invalid passId"),
  locationId: z.string().uuid("invalid locationId"),
  registrationNumber: z.string().min(1, "registrationNumber is required").max(20, "registrationNumber must be 20 characters or fewer"),
  vehicleType: z.enum(["two_wheeler", "car", "suv", "bus", "truck"], {
    errorMap: () => ({ message: "vehicleType must be one of: two_wheeler, car, suv, bus, truck" }),
  }),
  visitorCategory: z.enum(["vip", "standard", "handicapped"], {
    errorMap: () => ({ message: "visitorCategory must be one of: vip, standard, handicapped" }),
  }),
  driverName: z.string().max(200, "driverName must be 200 characters or fewer").nullable().optional(),
});
export type VehiclePassCreateBody = z.infer<typeof vehiclePassCreateBody>;
