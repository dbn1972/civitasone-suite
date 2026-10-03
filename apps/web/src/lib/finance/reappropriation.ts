import { parseRupeesToPaise } from "@/lib/money";

/** One budget (BE/RE) row as the re-appropriation pickers need it. `id` is the finance_budgets id. */
export type AllocationOption = { id: string; label: string; availableMinor: string };

/** Picker options from the finance budget list: "3054 · Roads · FY 2026-27", with the head's remaining balance. */
export function reappropriationOptionsFrom(
  budgets: readonly { id: string; majorHead?: string; subHead?: string | undefined; financialYear?: string; balance?: string }[],
): AllocationOption[] {
  return budgets.map((b) => ({
    id: b.id,
    label: [b.majorHead, b.subHead].filter(Boolean).join(" · ") + (b.financialYear ? ` · FY ${b.financialYear}` : ""),
    availableMinor: b.balance ?? "0",
  }));
}

export type ReappropriationInput = { fromBudgetId: string; toBudgetId: string; amount: string; reason: string };
export type ReappropriationErrorKey = "fromRequired" | "toRequired" | "sameBudget" | "amountInvalid" | "amountExceedsAvailable" | "reasonShort";

/**
 * Validate a re-appropriation request before anything is sent. `amount` is RUPEES as typed; the body carries
 * paise as an exact decimal string (never a float). The "exceeds available" check is a courtesy against the
 * allocation figures on screen; finance-service's consumer is the authority (a zero-sum transfer that refuses
 * insufficient savings).
 */
export function validateReappropriation(
  f: ReappropriationInput,
  options: readonly AllocationOption[],
):
  | { ok: true; body: { fromBudgetId: string; toBudgetId: string; amountMinor: string; reason: string } }
  | { ok: false; errors: Partial<Record<keyof ReappropriationInput, ReappropriationErrorKey>> } {
  const errors: Partial<Record<keyof ReappropriationInput, ReappropriationErrorKey>> = {};
  if (!f.fromBudgetId) errors.fromBudgetId = "fromRequired";
  if (!f.toBudgetId) errors.toBudgetId = "toRequired";
  if (f.fromBudgetId && f.fromBudgetId === f.toBudgetId) errors.toBudgetId = "sameBudget";
  const minor = parseRupeesToPaise(f.amount);
  if (minor === null) errors.amount = "amountInvalid";
  else {
    const from = options.find((o) => o.id === f.fromBudgetId);
    if (from && /^-?\d+$/.test(from.availableMinor) && BigInt(minor) > BigInt(from.availableMinor)) errors.amount = "amountExceedsAvailable";
  }
  if (f.reason.trim().length < 3) errors.reason = "reasonShort";
  if (Object.keys(errors).length > 0 || minor === null) return { ok: false, errors };
  return { ok: true, body: { fromBudgetId: f.fromBudgetId, toBudgetId: f.toBudgetId, amountMinor: minor, reason: f.reason.trim() } };
}
