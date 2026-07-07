import { z } from "zod";

/** Payment submission body — no PII fields, only financial identifiers. */
export const submitPaymentBody = z.object({
  referenceId: z.string().min(1, "referenceId is required").max(64),
  beneficiaryCode: z.string().min(1, "beneficiaryCode is required").max(64),
  amount: z.string().min(1, "amount is required").max(32).regex(/^\d+$/, "amount must be numeric paise string"),
  purposeCode: z.string().min(1, "purposeCode is required").max(32),
  schemeCode: z.string().max(32).optional(),
  ddoCode: z.string().max(32).optional(),
  remarks: z.string().max(2000).optional(),
});

/** Reference ID path parameter for status check. */
export const referenceParam = z.object({
  ref: z.string().min(1, "reference ID is required").max(64),
});

/** Account number path parameter for beneficiary lookup. */
export const accountParam = z.object({
  accountNo: z.string().min(1, "account number is required").max(32),
});
