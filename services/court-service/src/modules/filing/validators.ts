import { z } from "zod";
import { zMoneyMinor } from "@civitasone/schemas";

export const caseIdParam = z.object({ id: z.string().uuid() });

/**
 * Submit a filing on a case (§12/§31). Money fields are BigInt PAISE (minor
 * units): zMoneyMinor accepts a JSON-safe integer, a decimal string, or a
 * bigint and decodes to an exact bigint — an already-lossy (unsafe) JSON
 * number is REJECTED rather than silently truncated (see
 * packages/schemas/src/money.ts). Use a base-10 string on the wire for
 * amounts that may exceed Number.MAX_SAFE_INTEGER.
 */
export const submitFilingBody = z.object({
  filingType:     z.string().trim().min(1).max(32),
  filingFeeMinor: zMoneyMinor.refine((v) => v >= 0n, "filingFeeMinor must be a non-negative integer paise amount"),
  courtFeeMinor:  zMoneyMinor.refine((v) => v >= 0n, "courtFeeMinor must be a non-negative integer paise amount"),
});
export type SubmitFilingBody = z.infer<typeof submitFilingBody>;
