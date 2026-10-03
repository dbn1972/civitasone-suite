/**
 * GAP-PAYROLL-STATUTORY-PT-04: professional-tax slab VERSIONS -- pure rules.
 *
 * A version is (tenant, state, effective_from) plus its slab rows. It stays in
 * force until the next version of the same state starts. Everything here is
 * pure (no DB, no clock): the routes, the consumer and the run engine call it
 * with the data they already read, and the unit tests pin it.
 *
 * Statutory basis (HUMAN REVIEW / VERIFY):
 *   - Constitution of India, Article 276(2): the tax on professions, trades,
 *     callings and employments levied by a State shall not exceed Rs 2,500 per
 *     person per financial year. PT_ANNUAL_CAP_MINOR enforces it in the run
 *     engine regardless of what the slabs say.
 *   - The slab figures themselves are each State's PT Act and Rules and are
 *     entered per tenant; this module encodes no state's rates.
 */
import { z } from "zod";

/** Article 276(2): Rs 2,500 per person per financial year, in paise. */
export const PT_ANNUAL_CAP_MINOR = 250_000n;

/** "No upper bound" sentinel used by the existing slab rows (see 0005 seed). */
export const PT_NO_UPPER_BOUND_MINOR = 999_999_999_999;

/**
 * The month in which a State whose PT Act levies a different amount (so the
 * year's total lands on the Act's annual figure) applies it -- February, e.g.
 * the Maharashtra and Karnataka schedules. Applies only to a slab that carries
 * a February amount.
 */
export const PT_ADJUSTMENT_MONTH = 2;

export type PtSlab = { from: bigint; to: bigint; amount: bigint; februaryAmount: bigint | null };

/**
 * PT to deduct in `month` (YYYY-MM) for monthly pay `incomeMinor`:
 *   1. the slab whose inclusive range holds the income (none -> 0);
 *   2. its February amount in February when the state levies a different one,
 *      otherwise the ordinary monthly amount;
 *   3. clamped so the employee's PT for the financial year (what was already
 *      deducted, `ytdMinor`, plus this month) never exceeds the Article 276(2)
 *      cap.
 * With no February amount and a year-to-date well under the cap this equals the
 * plain slab lookup the engine always did, so existing runs are unchanged.
 */
export function computePtMonthMinor(
  slabs: readonly PtSlab[], incomeMinor: bigint, month: string, ytdMinor: bigint,
): bigint {
  const slab = slabs.find((s) => incomeMinor >= s.from && incomeMinor <= s.to);
  if (!slab) return 0n;
  const isFebruary = Number(month.slice(5, 7)) === PT_ADJUSTMENT_MONTH;
  const due = isFebruary && slab.februaryAmount !== null ? slab.februaryAmount : slab.amount;
  const remaining = PT_ANNUAL_CAP_MINOR > ytdMinor ? PT_ANNUAL_CAP_MINOR - ytdMinor : 0n;
  return due < remaining ? due : remaining;
}

/** Last calendar day of a YYYY-MM run month, as YYYY-MM-DD (the run's period end). */
export function periodEndOf(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}

/** The day after a YYYY-MM-DD date. */
export function dayAfter(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The day before a YYYY-MM-DD date. */
export function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Today's date (YYYY-MM-DD) in IST, the statutory calendar. */
export function todayIst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "must be a real calendar date");

const cap = Number(PT_ANNUAL_CAP_MINOR);

export const ptVersionSlab = z.object({
  fromMinor: z.number().int().nonnegative(),
  toMinor: z.number().int().nonnegative(),
  // A single month's PT can never exceed the annual cap (Article 276(2)).
  taxMinor: z.number().int().nonnegative().max(cap),
  februaryTaxMinor: z.number().int().nonnegative().max(cap).nullable().optional(),
}).refine((s) => s.toMinor >= s.fromMinor, { message: "toMinor must be >= fromMinor", path: ["toMinor"] });

export const createPtVersionBody = z.object({
  stateCode: z.string().trim().toUpperCase().min(2).max(4),
  effectiveFrom: isoDate,
  slabs: z.array(ptVersionSlab).min(1).max(50),
  reason: z.string().trim().min(10).max(500).optional(),
});
export type CreatePtVersionBody = z.infer<typeof createPtVersionBody>;

type Range = { fromMinor: number; toMinor: number };

/** First overlap (inclusive ranges) / duplicate start within one slab set, or null. */
export function findSlabSetProblem(slabs: readonly Range[]): string | null {
  const sorted = [...slabs].sort((a, b) => a.fromMinor - b.fromMinor);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur.fromMinor === prev.fromMinor) return `two slabs start at ${cur.fromMinor}`;
    if (cur.fromMinor <= prev.toMinor) {
      return `slab ${prev.fromMinor}-${prev.toMinor} overlaps slab ${cur.fromMinor}-${cur.toMinor}`;
    }
  }
  return null;
}

export type VersionGuardInput = {
  effectiveFrom: string;
  today: string;
  /** Month (YYYY-MM) of the latest finalised (approved / disbursed) run, or null. */
  latestFinalisedMonth: string | null;
  existingEffectiveFroms: readonly string[];
  reason: string | undefined;
};
export type VersionGuardFailure =
  | { code: "PT_VERSION_EXISTS"; message: string }
  | { code: "PT_BACKDATE_BEFORE_FINALISED_RUN"; message: string }
  | { code: "PT_BACKDATE_REASON_REQUIRED"; message: string };

/**
 * Whether a new version may start on `effectiveFrom`. A past date ("back-dating")
 * is allowed only AFTER the end of the latest finalised run's month -- the run
 * engine reads the version in force on the run's period end, so such a date can
 * never change what an already-finalised run paid -- and needs a recorded reason.
 */
export function checkNewVersion(i: VersionGuardInput): { ok: true; backDated: boolean } | { ok: false; failure: VersionGuardFailure } {
  if (i.existingEffectiveFroms.includes(i.effectiveFrom)) {
    return { ok: false, failure: { code: "PT_VERSION_EXISTS", message: `a version effective ${i.effectiveFrom} already exists for this state; versions are immutable, pick a different effective date` } };
  }
  if (i.latestFinalisedMonth && i.effectiveFrom <= periodEndOf(i.latestFinalisedMonth)) {
    return {
      ok: false,
      failure: {
        code: "PT_BACKDATE_BEFORE_FINALISED_RUN",
        message: `the ${i.latestFinalisedMonth} run is already finalised; a new version must take effect after ${periodEndOf(i.latestFinalisedMonth)}`,
      },
    };
  }
  const backDated = i.effectiveFrom < i.today;
  if (backDated && !(i.reason && i.reason.trim().length >= 10)) {
    return { ok: false, failure: { code: "PT_BACKDATE_REASON_REQUIRED", message: "a back-dated version needs a reason (at least 10 characters)" } };
  }
  return { ok: true, backDated };
}

export type VersionStatus = "past" | "current" | "upcoming";

export type VersionRow = { effectiveFrom: string; legacy: boolean };

/** Timeline: each version's end is the day before the next version starts (null = open-ended). */
export function buildTimeline<T extends VersionRow>(versions: readonly T[], today: string): Array<T & { effectiveTo: string | null; status: VersionStatus }> {
  const sorted = [...versions].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  return sorted.map((v, i) => {
    const next = sorted[i + 1];
    const effectiveTo = next ? dayBefore(next.effectiveFrom) : null;
    const status: VersionStatus = v.effectiveFrom > today ? "upcoming" : next && next.effectiveFrom <= today ? "past" : "current";
    return { ...v, effectiveTo, status };
  });
}
