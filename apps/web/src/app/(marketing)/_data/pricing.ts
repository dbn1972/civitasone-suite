/**
 * Shared marketing pricing constants.
 *
 * GAP-PRICING-HOME-03: the landing page and the pricing page previously
 * hard-coded their own price strings, which drifted ("₹0 licensing" on the
 * landing hero vs ₹15,000/month for PSU on /pricing). Keep the per-edition
 * figures here so both pages read the same source of truth.
 *
 * GAP-PRICING-HOME-04 decision: the billing-service plans contract
 * (GET /v1/billing/plans -> { id, name, code, priceMinor, currency,
 * govtExempt, active }) carries only price + code; it exposes no module
 * count, user limit, storage or SLA. There is therefore no backend
 * entitlement contract these marketing numbers can drift from. They are
 * honest static marketing copy, authored here, not fabricated per-request
 * values. Building an entitlement-driven pricing page (new plan-feature
 * view fields + seed + public fetch) is out of proportion to this gap and
 * would churn heavily-tested shared billing code, so it is intentionally
 * left as reviewed static copy. See HUMAN REVIEW.
 */

/** Monthly price for the free Small Office self-host edition, as display copy. */
export const SMALL_OFFICE_PRICE = "₹0/month";

/** Monthly price for the PSU edition, as display copy. */
export const PSU_PRICE = "₹15,000/month";

/**
 * Licensing claim for the landing hero / comparison, qualified to the edition
 * it actually applies to (HOME-03). Small Office is the ₹0 edition; PSU and
 * Government are paid, so the unqualified "₹0 licensing" was misleading.
 */
export const SMALL_OFFICE_LICENSING_LABEL = "₹0 licensing for Small Office";
