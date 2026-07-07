import { z } from "zod";

export const subscriptionIdParam = z.object({
  id: z.string().uuid(),
});

export const revenueForecastQuery = z.object({
  horizon: z.enum(["3", "6", "12"]),
});

export type RevenueForecastHorizon = 3 | 6 | 12;
