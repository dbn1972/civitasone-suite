/**
 * Forecast route validators (zod schemas).
 * Requirements: 8.6
 */
import { z } from "zod";

export const forecastParams = z.object({
  id: z.string().uuid("item ID must be a valid UUID"),
});

export const forecastQuery = z.object({
  warehouseId: z.string().uuid("warehouseId must be a valid UUID").optional(),
  horizon: z
    .enum(["30", "60", "90"], { message: "horizon must be 30, 60, or 90" })
    .default("30")
    .transform((v) => Number(v) as 30 | 60 | 90),
});
