import { z } from "zod";

export const createAdvanceBody = z.object({
  poRef:       z.string().min(1),
  vendorId:    z.string().uuid(),
  amountMinor: z.number().int().positive(),
  advanceType: z.enum(["mobilisation", "material"]).default("mobilisation"),
  currency:    z.string().length(3).default("INR"),
});
export type CreateAdvanceBody = z.infer<typeof createAdvanceBody>;

export const createDebitNoteBody = z.object({
  grnRef:      z.string().min(1),
  vendorId:    z.string().uuid(),
  reason:      z.string().min(5).max(500),
  amountMinor: z.number().int().positive(),
  currency:    z.string().length(3).default("INR"),
});
export type CreateDebitNoteBody = z.infer<typeof createDebitNoteBody>;

export const idParam = z.object({ id: z.string().uuid() });
