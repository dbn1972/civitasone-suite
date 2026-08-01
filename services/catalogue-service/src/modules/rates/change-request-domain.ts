/**
 * Pure validation for inbound `billing.rate.change_requested` events.
 *
 * No I/O, no clock, no randomness — the consumer gathers facts from the database
 * and this module decides. Kept separate so the decision table is unit-testable
 * without a transaction.
 */
import { z } from "zod";

/**
 * MONEY: minor units arrive as a decimal STRING. A JSON number is rejected rather
 * than coerced: by the time a value above 2^53 reaches us as a double it has
 * already lost precision, so "tolerating" it would silently corrupt a price.
 * 30 digits is far beyond any real paise amount and bounds the input.
 *
 * An optional leading `-` is ACCEPTED by the parser on purpose. A negative amount
 * is well-formed but commercially invalid, so letting it through here means the
 * decision table can answer with the precise NEGATIVE_AMOUNT code instead of the
 * catch-all MALFORMED_PAYLOAD. billing-service can act on the former; the latter
 * only tells it "we could not read your message".
 */
const minorUnitsString = z
  .string()
  .regex(/^-?\d{1,30}$/, "minor units must be a signed decimal integer string");

/**
 * Defensive parser for a foreign payload. `.passthrough()` keeps unknown fields
 * so a future additive change by billing-service does not turn every message into
 * a rejection; optional fields stay optional.
 */
export const rateChangeRequestedPayloadSchema = z
  .object({
    requestId: z.string().min(1).max(200),
    productId: z.string().uuid(),
    rateId: z.string().uuid().optional(),
    requestedRateMinor: minorUnitsString,
    currency: z.string().length(3).optional(),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "effectiveFrom must be an ISO date").optional(),
    reason: z.string().max(500).optional(),
  })
  .passthrough();

export type RateChangeRequestedPayload = z.infer<typeof rateChangeRequestedPayloadSchema>;

export const RATE_CHANGE_REJECTION_CODES = {
  malformedPayload: "MALFORMED_PAYLOAD",
  productNotFound: "PRODUCT_NOT_FOUND",
  rateNotFound: "RATE_NOT_FOUND",
  lifecycleClosed: "LIFECYCLE_CLOSED",
  negativeAmount: "NEGATIVE_AMOUNT",
  effectiveDateInPast: "EFFECTIVE_DATE_IN_PAST",
} as const;

export type RateChangeRejectionCode =
  (typeof RATE_CHANGE_REJECTION_CODES)[keyof typeof RATE_CHANGE_REJECTION_CODES];

export type RateChangeDecision =
  | { outcome: "accepted" }
  | { outcome: "rejected"; code: RateChangeRejectionCode; reason: string };

/**
 * A rate change is refused only once a product is fully off the shelf.
 *
 * `sunset` and `closed_to_new_business` still hold live business — existing
 * holdings are serviced and their pricing must remain correctable — so only the
 * terminal `retired` state closes the door. `null` means PC-002 lifecycle
 * tracking never began for this product, which is true of every product created
 * before migration 0004; treating that as closed would refuse the whole legacy
 * catalogue, so it is treated as open.
 */
export function isOpenForRateChange(lifecycleState: string | null, productStatus: string | null): boolean {
  if (lifecycleState === "retired") return false;
  // The governed status on catalogue.products is a second, independent axis
  // (draft → … → retired). Either axis reaching retirement closes the product.
  if (productStatus === "retired") return false;
  return true;
}

export interface RateChangeFacts {
  productExists: boolean;
  /** catalogue.products.lifecycle_status — null when the product is absent. */
  productStatus: string | null;
  /** Current PC-002 lifecycle state, or null when no history row exists. */
  lifecycleState: string | null;
  /**
   * Whether the referenced rate row was found and belongs to the referenced
   * product. `null` when the request named no specific rate (a request to price
   * the product generally, which is valid).
   */
  rateResolved: boolean | null;
  /**
   * MONEY: the requested amount in minor units as a bigint. Never a number — the
   * comparison below is exact for values above 2^53. `null` when the payload was
   * unreadable, in which case the amount rule cannot be evaluated.
   */
  requestedRateMinor: bigint | null;
  /** ISO date (YYYY-MM-DD) the change should take effect, or null when unspecified. */
  effectiveFrom: string | null;
  /**
   * Today as an ISO date (YYYY-MM-DD), injected by the caller. Passed in rather
   * than read from the clock here so this module stays pure and the boundary case
   * "effective today" is testable without freezing time.
   */
  today: string;
}

/**
 * Decision table.
 *
 * Order is deliberate: resolve WHICH entity is being talked about (product, rate),
 * then WHETHER it is still open to change (lifecycle), then WHAT is being asked
 * (amount, effective date). An unresolvable reference makes the later rules
 * meaningless, so it must win — otherwise billing could get NEGATIVE_AMOUNT for a
 * product that does not even exist and chase the wrong defect.
 */
export function decideRateChange(facts: RateChangeFacts): RateChangeDecision {
  if (!facts.productExists) {
    return {
      outcome: "rejected",
      code: RATE_CHANGE_REJECTION_CODES.productNotFound,
      reason: "Referenced product does not exist in this tenant's catalogue",
    };
  }
  if (facts.rateResolved === false) {
    return {
      outcome: "rejected",
      code: RATE_CHANGE_REJECTION_CODES.rateNotFound,
      reason: "Referenced rate does not exist for this product",
    };
  }
  if (!isOpenForRateChange(facts.lifecycleState, facts.productStatus)) {
    return {
      outcome: "rejected",
      code: RATE_CHANGE_REJECTION_CODES.lifecycleClosed,
      reason: `Product lifecycle is '${facts.lifecycleState ?? facts.productStatus ?? "unknown"}' and closed to rate changes`,
    };
  }
  // MONEY: bigint comparison against 0n. A negative price is not a thing we can
  // charge, so it is a business refusal rather than a parse error.
  if (facts.requestedRateMinor !== null && facts.requestedRateMinor < 0n) {
    return {
      outcome: "rejected",
      code: RATE_CHANGE_REJECTION_CODES.negativeAmount,
      reason: "Requested rate must be zero or a positive amount in minor units",
    };
  }
  // Backdating a price silently re-prices settled billing periods, so the
  // catalogue refuses it and billing must raise a corrective request instead.
  // Lexicographic comparison is exact for zero-padded YYYY-MM-DD, and the parser
  // has already guaranteed that shape. Effective *today* is allowed.
  if (facts.effectiveFrom !== null && facts.effectiveFrom < facts.today) {
    return {
      outcome: "rejected",
      code: RATE_CHANGE_REJECTION_CODES.effectiveDateInPast,
      reason: "Effective date is in the past; rate changes cannot be backdated",
    };
  }
  return { outcome: "accepted" };
}

/** Today in UTC as YYYY-MM-DD. The only clock read in this feature. */
export function todayIsoDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Compact, PII-free summary of a zod failure, safe to store and to log. Only
 * field paths and rule codes are kept — never the offending values, which come
 * from another service and could carry anything.
 */
export function summariseParseFailure(error: z.ZodError): string {
  const parts = error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}:${i.code}`);
  return `payload failed validation — ${parts.join(", ")}`.slice(0, 500);
}
