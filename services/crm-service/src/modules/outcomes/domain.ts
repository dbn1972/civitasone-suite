/**
 * outcomes module — pure domain rules (G18, spec §25.3).
 *
 * Nothing here touches the database, the bus or the clock, so every branch is unit
 * testable. The route calls these to answer 422 before publishing, and the CONSUMER calls
 * the same functions before writing: the route's read is a snapshot and the catalogue may
 * have moved by the time the command lands. A consumer that skipped this would trip the
 * CHECK constraints in migration 0090, and a CHECK violation rolls back the inbox row —
 * dead-lettering a command that is a validation failure, not a fault.
 */
import type { OutcomeType } from "./schema.js";

export interface RuleViolation {
  code: string;
  message: string;
  field?: string;
}

export const VIOLATIONS = {
  /** A conversion with no product cannot say what the customer actually took. */
  productRequired: "OUTCOME_PRODUCT_REQUIRED",
  /** "No" without a reason is the outcome this whole feature exists to stop. */
  reasonCodeRequired: "OUTCOME_REASON_CODE_REQUIRED",
  /** A deferral with no scheduled next step is an abandoned customer (AC-002). */
  followUpRequired: "OUTCOME_FOLLOW_UP_REQUIRED",
  reasonCodeInactive: "REASON_CODE_INACTIVE",
  reasonCodeNotApplicable: "REASON_CODE_NOT_APPLICABLE",
  amountInvalid: "OUTCOME_AMOUNT_INVALID",
  currencyRequired: "OUTCOME_CURRENCY_REQUIRED",
  amountRequired: "OUTCOME_AMOUNT_REQUIRED",
} as const;

/** The catalogue facts an outcome is validated against. */
export interface ReasonCodeFacts {
  code: string;
  active: boolean;
  /** Empty = applicable to every outcome type. */
  appliesTo: OutcomeType[];
}

export interface OutcomeCandidate {
  outcomeType: OutcomeType;
  /** null when the caller supplied no reason code. */
  reasonCode: ReasonCodeFacts | null;
  productId: string | null;
  /** Decimal string of MINOR units, as it arrives on the wire. */
  amountMinor: string | null;
  currency: string | null;
  followUpNextActionId: string | null;
}

/** A decimal string of non-negative minor units. No sign, no separators, no exponent. */
const MINOR_UNITS = /^\d{1,25}$/;

/**
 * Parse minor units as an exact bigint, or null when the string is not one.
 *
 * Deliberately not `Number()` and not `BigInt()` unguarded: `BigInt("1e3")` throws,
 * `Number("9007199254740993")` silently rounds, and both would let a bad amount reach the
 * money column. Callers treat null as {@link VIOLATIONS.amountInvalid}.
 */
export function parseMinorUnits(raw: string): bigint | null {
  if (!MINOR_UNITS.test(raw)) return null;
  return BigInt(raw);
}

/** True when the code's applicability covers this outcome type (empty = all). */
export function isReasonCodeApplicable(appliesTo: OutcomeType[], outcomeType: OutcomeType): boolean {
  return appliesTo.length === 0 || appliesTo.includes(outcomeType);
}

/**
 * The propensity signal an outcome contributes: +1 converted, 0 deferred, -1 declined.
 *
 * This is on the EVENT rather than left to each consumer to derive, so the propensity
 * model, cross-sell attribution and analytics cannot disagree about what a deferral is
 * worth. It is intentionally coarse — the reason code carries the nuance, and a weight
 * per reason code is a model-side concern, not a CRM one.
 */
export function propensitySignal(outcomeType: OutcomeType): 1 | 0 | -1 {
  switch (outcomeType) {
    case "converted":
      return 1;
    case "declined":
      return -1;
    default:
      return 0;
  }
}

/**
 * Every rule that decides whether an outcome may be recorded, in one place.
 *
 * Returns ALL violations rather than the first, so a caller fixing a form is told
 * everything that is wrong in one round trip.
 */
export function validateOutcome(c: OutcomeCandidate): RuleViolation[] {
  const violations: RuleViolation[] = [];

  if (c.outcomeType === "converted" && c.productId === null) {
    violations.push({
      code: VIOLATIONS.productRequired,
      message: "a converted outcome must name the product the customer took",
      field: "productId",
    });
  }

  if (c.outcomeType === "declined" && c.reasonCode === null) {
    violations.push({
      code: VIOLATIONS.reasonCodeRequired,
      message: "a declined outcome must carry a reason code",
      field: "reasonCodeId",
    });
  }

  if (c.outcomeType === "deferred" && c.followUpNextActionId === null) {
    violations.push({
      code: VIOLATIONS.followUpRequired,
      message: "a deferred outcome must reference a scheduled follow-up next action",
      field: "followUpNextActionId",
    });
  }

  if (c.reasonCode !== null) {
    if (!c.reasonCode.active) {
      violations.push({
        code: VIOLATIONS.reasonCodeInactive,
        message: `reason code '${c.reasonCode.code}' is retired and cannot be used for new outcomes`,
        field: "reasonCodeId",
      });
    }
    if (!isReasonCodeApplicable(c.reasonCode.appliesTo, c.outcomeType)) {
      violations.push({
        code: VIOLATIONS.reasonCodeNotApplicable,
        message: `reason code '${c.reasonCode.code}' does not apply to a ${c.outcomeType} outcome`,
        field: "reasonCodeId",
      });
    }
  }

  if (c.amountMinor !== null) {
    if (parseMinorUnits(c.amountMinor) === null) {
      violations.push({
        code: VIOLATIONS.amountInvalid,
        message: "amountMinor must be a decimal string of non-negative minor units",
        field: "amountMinor",
      });
    }
    if (c.currency === null) {
      violations.push({
        code: VIOLATIONS.currencyRequired,
        message: "an amount without a currency cannot be aggregated",
        field: "currency",
      });
    }
  } else if (c.currency !== null) {
    violations.push({
      code: VIOLATIONS.amountRequired,
      message: "a currency was supplied with no amount",
      field: "amountMinor",
    });
  }

  return violations;
}

/** Next catalogue revision for a reason code. Kept here so the +1 lives in one place. */
export function nextVersionNumber(current: number): number {
  return current + 1;
}
