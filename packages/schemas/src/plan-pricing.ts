/**
 * M6 — price store rules (pure).
 *
 * Money is INR in MINOR UNITS (paise) as bigint; never a float. GST is shown SEPARATELY: every price row stores the
 * net amount and its GST rate (basis points, 1800 = 18%); a quote returns net, GST and gross per line and in total.
 * Rows are effective-dated and append-only: a new price for a subject closes the open one the day before it starts.
 * The price of something on a date is whatever row covers that date.
 *
 * Subjects: a plan (subjectKey = plan code) or an add-on module (subjectKey = catalogue module id), per billing cycle.
 */
import { CATALOGUE_BY_ID } from "./module-catalogue.js";

export const DEFAULT_GST_RATE_BPS = 1800;
export type PriceSubjectKind = "plan" | "addon";
export type PriceBillingCycle = "monthly" | "quarterly" | "annual";

export interface PriceRow {
  readonly id?: string;
  readonly subjectKind: PriceSubjectKind;
  readonly subjectKey: string;
  readonly billingCycle: PriceBillingCycle;
  /** Net price in paise (excludes GST). */
  readonly amountMinor: bigint;
  /** GST rate in basis points (1800 = 18%). */
  readonly gstRateBps: number;
  /** First day the price applies, YYYY-MM-DD (inclusive). */
  readonly effectiveFrom: string;
  /** Last day the price applies, YYYY-MM-DD (inclusive); null = open-ended. */
  readonly effectiveTo: string | null;
}

export class PriceError extends Error {
  constructor(
    public readonly code: "PRICE_NOT_FOUND" | "PRICE_WINDOW_OVERLAP" | "PRICE_BACKDATED" | "PRICE_INVALID" | "ADDON_ALREADY_IN_PLAN" | "ADDON_MISSING_DEPENDENCY",
    message: string,
  ) {
    super(message);
    this.name = "PriceError";
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
function dayNumber(d: string): number {
  if (!DAY.test(d)) throw new PriceError("PRICE_INVALID", `not a YYYY-MM-DD date: ${d}`);
  const t = Date.parse(`${d}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== d) throw new PriceError("PRICE_INVALID", `not a real date: ${d}`);
  return t / 86_400_000;
}
export function addPriceDays(d: string, n: number): string {
  return new Date((dayNumber(d) + n) * 86_400_000).toISOString().slice(0, 10);
}

export function assertValidPrice(p: PriceRow): void {
  if (p.amountMinor < 0n) throw new PriceError("PRICE_INVALID", "amountMinor must be >= 0");
  if (!Number.isInteger(p.gstRateBps) || p.gstRateBps < 0 || p.gstRateBps > 10_000) throw new PriceError("PRICE_INVALID", "gstRateBps must be an integer 0..10000");
  const from = dayNumber(p.effectiveFrom);
  if (p.effectiveTo !== null && dayNumber(p.effectiveTo) < from) throw new PriceError("PRICE_INVALID", "effectiveTo is before effectiveFrom");
}

const same = (a: PriceRow, b: PriceRow): boolean => a.subjectKind === b.subjectKind && a.subjectKey === b.subjectKey && a.billingCycle === b.billingCycle;
const covers = (r: PriceRow, day: number): boolean => dayNumber(r.effectiveFrom) <= day && (r.effectiveTo === null || day <= dayNumber(r.effectiveTo));

/** The row in force for a subject on a date, or null. */
export function priceAt(rows: readonly PriceRow[], kind: PriceSubjectKind, key: string, cycle: PriceBillingCycle, onDate: string): PriceRow | null {
  const day = dayNumber(onDate);
  const hit = rows.filter((r) => r.subjectKind === kind && r.subjectKey === key && r.billingCycle === cycle && covers(r, day));
  if (hit.length === 0) return null;
  return hit.reduce((a, b) => (dayNumber(b.effectiveFrom) > dayNumber(a.effectiveFrom) ? b : a));
}

export interface PriceInsertPlan {
  /** Existing open-ended row to close, and the last day it now covers. null when nothing is open. */
  readonly close: { readonly id: string | undefined; readonly effectiveTo: string } | null;
}

/**
 * Decide what inserting `next` does to the rows already stored for the same subject.
 * A new price must start AFTER the start of every stored price (no back-dating into history) and must not overlap a
 * closed window; the open-ended predecessor, if any, is closed the day before `next` starts.
 */
export function planPriceInsert(existing: readonly PriceRow[], next: PriceRow): PriceInsertPlan {
  assertValidPrice(next);
  const sibs = existing.filter((r) => same(r, next));
  const from = dayNumber(next.effectiveFrom);
  for (const r of sibs) {
    if (dayNumber(r.effectiveFrom) >= from) {
      throw new PriceError("PRICE_BACKDATED", `a price starting ${r.effectiveFrom} already exists for ${next.subjectKind} ${next.subjectKey}; a new price must start after it`);
    }
  }
  let close: PriceInsertPlan["close"] = null;
  for (const r of sibs) {
    if (r.effectiveTo === null) {
      close = { id: r.id, effectiveTo: addPriceDays(next.effectiveFrom, -1) };
    } else if (dayNumber(r.effectiveTo) >= from) {
      throw new PriceError("PRICE_WINDOW_OVERLAP", `the price ${r.effectiveFrom}..${r.effectiveTo} overlaps a price starting ${next.effectiveFrom}`);
    }
  }
  return { close };
}

export interface GstSplit { readonly netMinor: bigint; readonly gstMinor: bigint; readonly grossMinor: bigint }

/** GST on a net amount, rounded half-up to the paisa. */
export function gstSplit(netMinor: bigint, gstRateBps: number): GstSplit {
  const gst = (netMinor * BigInt(gstRateBps) + 5_000n) / 10_000n;
  return { netMinor, gstMinor: gst, grossMinor: netMinor + gst };
}

export interface QuoteLine extends GstSplit {
  readonly kind: PriceSubjectKind;
  readonly key: string;
  readonly gstRateBps: number;
  readonly effectiveFrom: string;
}
export interface Quote {
  readonly currency: "INR";
  readonly onDate: string;
  readonly billingCycle: PriceBillingCycle;
  readonly lines: readonly QuoteLine[];
  readonly totals: GstSplit;
}

export interface QuoteInput {
  readonly rows: readonly PriceRow[];
  readonly planCode: string;
  /** Modules the plan already includes (add-ons for these are refused: you cannot buy what you have). */
  readonly planModuleIds: readonly string[];
  readonly addonModuleIds?: readonly string[];
  readonly billingCycle: PriceBillingCycle;
  readonly onDate: string;
}

export function quote(input: QuoteInput): Quote {
  const lines: QuoteLine[] = [];
  const line = (kind: PriceSubjectKind, key: string): void => {
    const row = priceAt(input.rows, kind, key, input.billingCycle, input.onDate);
    if (!row) throw new PriceError("PRICE_NOT_FOUND", `no ${input.billingCycle} price for ${kind} ${key} on ${input.onDate}`);
    lines.push({ kind, key, gstRateBps: row.gstRateBps, effectiveFrom: row.effectiveFrom, ...gstSplit(row.amountMinor, row.gstRateBps) });
  };
  line("plan", input.planCode);
  const included = new Set(input.planModuleIds);
  const addons = [...new Set(input.addonModuleIds ?? [])];
  // an add-on is sellable only when everything it hard-depends on is in the plan or among the other add-ons
  const covered = new Set<string>([...included, ...addons]);
  for (const id of addons) {
    for (const dep of CATALOGUE_BY_ID.get(id)?.hardDeps ?? []) {
      if (!CATALOGUE_BY_ID.get(dep)?.isCore && !covered.has(dep)) {
        throw new PriceError("ADDON_MISSING_DEPENDENCY", `add-on ${id} needs module ${dep}, which is not in plan ${input.planCode} or the other add-ons`);
      }
    }
  }
  for (const id of addons) {
    if (included.has(id)) throw new PriceError("ADDON_ALREADY_IN_PLAN", `module ${id} is already included in plan ${input.planCode}`);
    line("addon", id);
  }
  const totals = lines.reduce<GstSplit>(
    (t, l) => ({ netMinor: t.netMinor + l.netMinor, gstMinor: t.gstMinor + l.gstMinor, grossMinor: t.grossMinor + l.grossMinor }),
    { netMinor: 0n, gstMinor: 0n, grossMinor: 0n },
  );
  return { currency: "INR", onDate: input.onDate, billingCycle: input.billingCycle, lines, totals };
}
