import { z } from "zod";

export const createChallanBody = z.object({
  // The challan number is allocated by the consumer from the gapless CHLN series; this field is
  // accepted for compatibility and ignored, so a client never has to invent one.
  challanNo:     z.string().min(1).max(64).default("AUTO"),
  receiptHeadId: z.string().uuid(),
  depositor:     z.string().min(1).max(200),
  amountMinor:   z.number().int().positive(),
  currency:      z.string().length(3).default("INR"),
  grnNo:         z.string().optional(),
  bankAccountId: z.string().uuid().optional(),
});
export type CreateChallanBody = z.infer<typeof createChallanBody>;

export const createDepositBody = z.object({
  pdNo:          z.string().min(1).max(64),
  type:          z.enum(["pd", "emd", "sd", "fdr"]),
  administrator: z.string().min(1).max(200),
  balanceMinor:  z.number().int().nonnegative(),
  currency:      z.string().length(3).default("INR"),
});
export type CreateDepositBody = z.infer<typeof createDepositBody>;

export const depositDispositionBody = z.object({
  amountMinor: z.number().int().positive(),
  billId:      z.string().uuid().optional(),
});
export type DepositDispositionBody = z.infer<typeof depositDispositionBody>;

export const idParam = z.object({ id: z.string().uuid() });
