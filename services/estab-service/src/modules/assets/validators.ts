import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid() });

export const createVehicleBody = z.object({
  regNo:       z.string().min(1),
  makeModel:   z.string().min(1),
  fuelType:    z.enum(["petrol", "diesel", "cng", "ev"]).default("petrol"),
  allocatedTo: z.string().uuid().optional(),
});
export type CreateVehicleBody = z.infer<typeof createVehicleBody>;

export const bookVehicleBody = z.object({
  vehicleId:   z.string().uuid(),
  requestedBy: z.string().uuid(),
  driverId:    z.string().uuid().optional(),
  purpose:     z.string().min(1),
  fromDt:      z.string().datetime(),
  toDt:        z.string().datetime(),
});
export type BookVehicleBody = z.infer<typeof bookVehicleBody>;

export const returnVehicleBody = z.object({
  odometerKm: z.number().int().nonnegative().optional(),
});
export type ReturnVehicleBody = z.infer<typeof returnVehicleBody>;
