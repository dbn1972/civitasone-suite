import { z } from "zod";
import { zMoneyMinor as zMoneyMinorBase } from "@civitasone/schemas/money";

// GAP2-FINANCE-TREASURY-MONEY-05: bigint-safe paise, matching payments/budget
// (rule 11). A plain z.number() caps at 2^53 — a 17-digit government
// challan/deposit amount silently loses precision at the JSON.parse boundary
// before Zod ever sees it (or is rejected). zMoneyMinorBase accepts
// string | safe-integer number | bigint and forces unsafe numbers onto the
// string path, so a large amount is accepted and stored exactly.
const moneyMinorPositive = zMoneyMinorBase.pipe(z.bigint().positive());
const moneyMinorNonNeg = zMoneyMinorBase.pipe(z.bigint().nonnegative());

export const createChallanBody = z.object({
  // The challan number is allocated by the consumer from the gapless CHLN series; this field is
  // accepted for compatibility and ignored, so a client never has to invent one.
  challanNo:     z.string().min(1).max(64).default("AUTO"),
  receiptHeadId: z.string().uuid(),
  depositor:     z.string().min(1).max(200),
  amountMinor:   moneyMinorPositive,
  currency:      z.string().length(3).default("INR"),
  grnNo:         z.string().optional(),
  bankAccountId: z.string().uuid().optional(),
});
export type CreateChallanBody = z.infer<typeof createChallanBody>;

export const createDepositBody = z.object({
  pdNo:          z.string().min(1).max(64),
  type:          z.enum(["pd", "emd", "sd", "fdr"]),
  administrator: z.string().min(1).max(200),
  balanceMinor:  moneyMinorNonNeg,
  currency:      z.string().length(3).default("INR"),
});
export type CreateDepositBody = z.infer<typeof createDepositBody>;

export const depositDispositionBody = z.object({
  amountMinor: moneyMinorPositive,
  billId:      z.string().uuid().optional(),
});
export type DepositDispositionBody = z.infer<typeof depositDispositionBody>;

export const idParam = z.object({ id: z.string().uuid() });
