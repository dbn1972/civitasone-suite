import { z } from "zod";
import { EstabCreateVehicleBodySchema } from "@civitasone/schemas/web";

export const idParam = z.object({ id: z.string().uuid() });

// The create-vehicle request contract lives in @civitasone/schemas so the web form builds against the same schema.
export const createVehicleBody = EstabCreateVehicleBodySchema;
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
