import { z } from "zod";

export const transferBody = z.object({
  fromLocation: z.string().min(1),
  toLocation:   z.string().min(1),
  transferDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes:        z.string().optional(),
});
export type TransferBody = z.infer<typeof transferBody>;

export const disposeBody = z.object({
  disposalDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  disposalMethod: z.string().min(1).max(32).default("sale"),
  proceedsMinor:  z.number().int().nonnegative().default(0),
  currency:       z.string().length(3).default("INR"),
  notes:          z.string().optional(),
});
export type DisposeBody = z.infer<typeof disposeBody>;

export const idParam = z.object({ id: z.string().uuid() });
