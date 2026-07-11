import { z } from "zod";

export const caseIdParam = z.object({ id: z.string().uuid() });

/** Submit a filing on a case (§12/§31). Money fields are BigInt PAISE (minor units). */
export const submitFilingBody = z.object({
  filingType:     z.string().trim().min(1).max(32),
  filingFeeMinor: z.coerce.number().int().min(0),
  courtFeeMinor:  z.coerce.number().int().min(0),
});
export type SubmitFilingBody = z.infer<typeof submitFilingBody>;
