import { rupeesToMinorString } from "@/lib/money";

export type SanctionFormErrors = { sanctionNo?: string; purpose?: string; headId?: string; amount?: string };

export type SanctionFormInput = { sanctionNo: string; purpose: string; headId: string; amount: string };

/**
 * Client-side checks for the New Sanction form (GAP-FINANCE-BUDGET-SANCTIONS-01),
 * mirroring finance-service's createSanctionBody. `amountMinor` is the exact
 * paise string (rupeesToMinorString -- never Number(x) * 100) and is only
 * present when every field is valid.
 */
export function validateSanction(input: SanctionFormInput): { errors: SanctionFormErrors; amountMinor: string | null } {
  const errors: SanctionFormErrors = {};
  const sanctionNo = input.sanctionNo.trim();
  const purpose = input.purpose.trim();
  if (!sanctionNo) errors.sanctionNo = "Enter the sanction order number.";
  else if (sanctionNo.length > 64) errors.sanctionNo = "Sanction number must be at most 64 characters.";
  if (purpose.length < 3) errors.purpose = "Enter the subject of the sanction (at least 3 characters).";
  else if (purpose.length > 500) errors.purpose = "Subject must be at most 500 characters.";
  if (!input.headId) errors.headId = "Select the budget head this sanction is charged to.";
  const amountMinor = rupeesToMinorString(input.amount);
  if (amountMinor === null) errors.amount = "Enter an amount in rupees greater than 0, with at most 2 decimals.";
  const valid = !errors.sanctionNo && !errors.purpose && !errors.headId && !errors.amount;
  return { errors, amountMinor: valid ? amountMinor : null };
}
