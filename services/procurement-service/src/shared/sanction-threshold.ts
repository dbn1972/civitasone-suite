/**
 * Single source for the procurement sanction threshold (#14 / tender C2; UAT
 * Phase 2 security review #2446 (5) — it was duplicated in po/consumer.ts,
 * tender/consumer.ts and po/domain.ts).
 *
 * A purchase order or tender award whose value is ABOVE this amount (Rs 1,000,
 * in paise) must cite a budget sanction (`sanctionRef`). Below or at it, the
 * order may proceed without one. This is the platform's existing #14 rule, not
 * a tenant-configurable GFR band; changing it is a policy decision.
 */
export const SANCTION_REQUIRED_ABOVE_MINOR = 100000n;
