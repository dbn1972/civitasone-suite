/** zod validators — applied at the route boundary for three-way match operations. */
import { z } from "zod";

export const matchStatus = z.enum(["pending", "matched", "mismatch", "exception", "resolved"]);

export const createMatchBody = z.object({
  poId:              z.string().uuid(),
  poLineId:         z.string().uuid().optional(),
  grnId:            z.string().uuid(),
  invoiceId:        z.string().uuid(),
  poQty:            z.number().int().nonnegative().max(10_000_000),
  poRatePaise:      z.string().regex(/^\d+$/, "Must be numeric string (paise)").transform((v) => BigInt(v)),
  grnQty:           z.number().int().nonnegative().max(10_000_000),
  invoiceQty:       z.number().int().nonnegative().max(10_000_000),
  invoiceRatePaise: z.string().regex(/^\d+$/, "Must be numeric string (paise)").transform((v) => BigInt(v)),
  tolerancePct:     z.number().nonnegative().max(100).default(5),
  toleranceAbsPaise: z.string().regex(/^\d+$/).transform((v) => BigInt(v)).optional(),
});
export type CreateMatchBody = z.infer<typeof createMatchBody>;

export const resolveMatchBody = z.object({
  version:        z.number().int().positive(),
  resolutionNote: z.string().min(1).max(1000),
});
export type ResolveMatchBody = z.infer<typeof resolveMatchBody>;

export const matchQueryParams = z.object({
  poId:       z.string().uuid().optional(),
  grnId:      z.string().uuid().optional(),
  invoiceId:  z.string().uuid().optional(),
  status:     z.string().max(32).optional(),
  limit:      z.coerce.number().int().positive().max(200).default(50),
  offset:     z.coerce.number().int().nonnegative().default(0),
});

export const idParam = z.object({ id: z.string().uuid() });
