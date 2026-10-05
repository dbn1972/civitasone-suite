/**
 * GAP-CRM-PIPELINE-03: the "High-Value Engagements" tile used an unlabelled,
 * hard-coded 1_000_000 paise (= ₹10,000) threshold. For government/PSU
 * procurement — where departmental contracts run to lakhs and crores — ₹10,000
 * is trivially low, so almost every engagement counts and the tile effectively
 * duplicates the total.
 *
 * DECISION (recorded, not stalled): the threshold is now a named bigint-paise
 * constant set to ₹1 crore. One crore rupees = 10,000,000 rupees =
 * 1,000,000,000 paise. This is the safest sensible default for the stated
 * context; if a tenant needs a different cut-off it should become
 * tenant-configurable, but that needs a settings surface not present here. The
 * tile label now states the threshold via formatMoney so it is never a magic
 * number on screen.
 */
export const HIGH_VALUE_MINOR = 1_000_000_000n; // ₹1,00,00,000.00 (1 crore) in paise
