/**
 * visitor-service: check-in validity window (pure) + tenant policy loader.
 *
 * A pass is stored with [validFrom, validUntil]. For a "single" pass validFrom is the SCHEDULED
 * TIME of the visit (e.g. 10:00) and validUntil the end of that day, so a visitor arriving at 09:40
 * was refused "not yet valid". Two tenant knobs (visitor_policy), both defaulting to the previous
 * strict behaviour so this is a no-op for tenants that configure nothing:
 *
 *   check_in.allow_from_start_of_day  (bool, default false)  admit from 00:00 (IST) of the day on
 *                                     which the pass becomes valid, instead of from validFrom.
 *   check_in.expiry_grace_minutes     (0-1440, default 0)    admit up to N minutes after validUntil.
 *
 * Security is unchanged where it matters: a pass outside [windowStart, validUntil + grace] is still
 * refused, and revocation / identity / blacklist gates are untouched.
 */
import type { Writer } from "../config-registry/repo.js";
import { getPolicyBoolean, getPolicyNumber } from "../config-registry/policy.js";

/** India has no DST; the product is for .gov.in sites, so "the scheduled day" means the IST day. */
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface CheckInWindowPolicy {
  /** Admit from the start of the (IST) day on which validFrom falls. */
  fromStartOfDay: boolean;
  /** Admit up to this long after validUntil. */
  graceMs: number;
}

/** Strict, pre-existing behaviour. */
export const STRICT_WINDOW_POLICY: CheckInWindowPolicy = { fromStartOfDay: false, graceMs: 0 };

export type CheckInWindowResult =
  | { ok: true }
  | { ok: false; code: "PASS_NOT_YET_VALID" | "PASS_EXPIRED"; message: string };

/** 00:00 IST of the day containing `d`, as an absolute instant. */
export function startOfIstDay(d: Date): Date {
  const local = d.getTime() + IST_OFFSET_MS;
  return new Date(Math.floor(local / MS_PER_DAY) * MS_PER_DAY - IST_OFFSET_MS);
}

/** Earliest / latest instants at which the pass may be checked in under `policy`. */
export function checkInWindowBounds(
  validFrom: Date, validUntil: Date, policy: CheckInWindowPolicy,
): { opensAt: Date; closesAt: Date } {
  const opensAt = policy.fromStartOfDay ? startOfIstDay(validFrom) : validFrom;
  return { opensAt, closesAt: new Date(validUntil.getTime() + policy.graceMs) };
}

/** Boundaries are inclusive, matching isOverstayed(). Fails closed on an invalid timestamp. */
export function evaluateCheckInWindow(
  at: Date, validFrom: Date, validUntil: Date, policy: CheckInWindowPolicy = STRICT_WINDOW_POLICY,
): CheckInWindowResult {
  const t = at.getTime();
  if (Number.isNaN(t)) {
    return { ok: false, code: "PASS_NOT_YET_VALID", message: "check-in timestamp is not a valid date" };
  }
  const { opensAt, closesAt } = checkInWindowBounds(validFrom, validUntil, policy);
  if (t < opensAt.getTime()) {
    return {
      ok: false, code: "PASS_NOT_YET_VALID",
      message: `pass is not yet valid: check-in opens at ${opensAt.toISOString()} (validFrom=${validFrom.toISOString()}), attempted ${at.toISOString()}`,
    };
  }
  if (t > closesAt.getTime()) {
    return {
      ok: false, code: "PASS_EXPIRED",
      message: `pass has expired: validUntil=${validUntil.toISOString()}${policy.graceMs > 0 ? ` (+${policy.graceMs / MS_PER_MINUTE} min grace)` : ""}, attempted ${at.toISOString()}`,
    };
  }
  return { ok: true };
}

/** Load the tenant's window policy (defaults = strict) on a GUC-scoped tx. */
export async function loadCheckInWindowPolicy(tx: Writer, tenantId: string): Promise<CheckInWindowPolicy> {
  const [fromStartOfDay, graceMin] = await Promise.all([
    getPolicyBoolean(tx, tenantId, "check_in.allow_from_start_of_day"),
    getPolicyNumber(tx, tenantId, "check_in.expiry_grace_minutes"),
  ]);
  return { fromStartOfDay, graceMs: graceMin * MS_PER_MINUTE };
}
