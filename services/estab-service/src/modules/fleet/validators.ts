import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid() });

export const createFuelLogBody = z.object({
  vehicleId:  z.string().uuid(),
  logDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fuelType:   z.enum(["petrol", "diesel", "cng", "ev"]),
  litres:     z.string().regex(/^\d+(\.\d{1,2})?$/),
  costMinor:  z.number().int().positive(),
  odometerKm: z.number().int().nonnegative(),
  pumpName:   z.string().max(200).optional(),
  receiptRef: z.string().max(64).optional(),
});
export type CreateFuelLogBody = z.infer<typeof createFuelLogBody>;

export const createTripLogBody = z.object({
  vehicleId:     z.string().uuid(),
  driverId:      z.string().uuid().optional(),
  tripDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startOdometer: z.number().int().nonnegative(),
  startTime:     z.string().datetime(),
  purpose:       z.string().min(1).max(500),
  passengerName: z.string().max(200).optional(),
  route:         z.string().max(500).optional(),
});
export type CreateTripLogBody = z.infer<typeof createTripLogBody>;

export const completeTripBody = z.object({
  endOdometer: z.number().int().nonnegative(),
  endTime:     z.string().datetime(),
  version:     z.number().int().positive(),
});
export type CompleteTripBody = z.infer<typeof completeTripBody>;

export const createVehicleDocBody = z.object({
  vehicleId:   z.string().uuid(),
  docType:     z.enum(["permit", "insurance", "puc", "fitness", "tax", "registration"]),
  docNumber:   z.string().max(128).optional(),
  validFrom:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  validUntil:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  issuer:      z.string().max(200).optional(),
  amountMinor: z.number().int().nonnegative().optional(),
});
export type CreateVehicleDocBody = z.infer<typeof createVehicleDocBody>;

export const createDriverRosterBody = z.object({
  driverId:  z.string().uuid(),
  vehicleId: z.string().uuid().optional(),
  shiftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shiftType: z.enum(["day", "night", "split"]).default("day"),
});
export type CreateDriverRosterBody = z.infer<typeof createDriverRosterBody>;

export const fleetQueryParams = z.object({
  vehicleId: z.string().uuid().optional(),
  from:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit:     z.coerce.number().int().positive().max(200).default(50),
  offset:    z.coerce.number().int().nonnegative().default(0),
});
