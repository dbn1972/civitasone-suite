import { z } from "zod";

export const physicalProgressBody = z.object({
  componentId:   z.string().uuid().optional(),
  periodDate:    z.string().min(1),
  physicalPct:   z.number().min(0).max(100),
  notes:         z.string().max(1000).optional(),
});
export type PhysicalProgressBody = z.infer<typeof physicalProgressBody>;

export const financialProgressBody = z.object({
  periodDate:        z.string().min(1),
  expenditureMinor:  z.number().int().nonnegative(),
  notes:             z.string().max(1000).optional(),
});
export type FinancialProgressBody = z.infer<typeof financialProgressBody>;

export const dprBody = z.object({
  dprNo:     z.string().min(1).max(64),
  dprDate:   z.string().min(1),
  content:   z.record(z.unknown()).default({}),
});
export type DprBody = z.infer<typeof dprBody>;

export const idParam = z.object({ id: z.string().uuid() });
