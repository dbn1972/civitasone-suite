/**
 * GAP-PAYROLL-STATUTORY-GRATUITY-04 [HUMAN REVIEW: statutory compliance]:
 * moved out of GratuityCalculator.tsx into their own module so the register
 * (gratuity/page.tsx) and the calculator share one source instead of only
 * the calculator knowing the ceiling exists. The VALUES are unchanged from
 * before this change (₹20,00,000 / 26 working days) -- this is a relocation
 * for single-sourcing + display, not a statutory-rule decision. Wiring this
 * to a backend tax-config endpoint instead of a code constant is explicitly
 * left open (see the PR description): "do not invent an endpoint" when none
 * currently exposes this value to the frontend.
 */
export const GRATUITY_CEILING_PAISE = 2_000_000_00; // ₹20,00,000 per GoI (Payment of Gratuity Act)
export const GRATUITY_DAYS = 15;
export const WORKING_DAYS_PER_MONTH = 26;
