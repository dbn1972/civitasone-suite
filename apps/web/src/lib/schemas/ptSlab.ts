import { z } from "zod";
import { INDIAN_STATE_UT_CODES } from "@/lib/india/states";

/**
 * GAP-PAYROLL-STATUTORY-PT-04 [HUMAN REVIEW: statutory compliance]: client
 * validation of one professional-tax slab, mirroring payroll-service
 * (modules/payroll/state-rules.ts, the authority):
 *   - ranges are INCLUSIVE paise ranges, "To" may equal "From";
 *   - an existing slab of the same state with the SAME "From" is the row the
 *     POST upserts, so it is not an overlap;
 *   - the state must be a real state / UT code.
 * The server re-checks all of it (422 PT_SLAB_OVERLAP); this only saves the
 * round trip and puts the message next to the field.
 */

export const ptSlabInput = z
  .object({
    stateCode: z.string().refine((c) => INDIAN_STATE_UT_CODES.includes(c), { message: "state" }),
    fromMinor: z.number().int().nonnegative(),
    toMinor: z.number().int().nonnegative(),
    taxMinor: z.number().int().nonnegative(),
    /** YYYY-MM-DD; blank/undefined = keep the stored date (a new slab gets the column default). */
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .refine((s) => s.toMinor >= s.fromMinor, { path: ["toMinor"], message: "range" });

export type PtSlabInput = z.infer<typeof ptSlabInput>;

export type ExistingPtSlab = {
  state_code: string;
  slab_from_minor: number | string;
  slab_to_minor: number | string;
};

type Range = { from: number; to: number };

/** Existing slabs of `stateCode`, as numbers, EXCLUDING the one this slab would update (same From). */
function otherSlabs(stateCode: string, fromMinor: number, existing: readonly ExistingPtSlab[]): Range[] {
  const code = stateCode.toUpperCase();
  return existing
    .filter((s) => (s.state_code ?? "").toUpperCase() === code)
    .map((s) => ({ from: Number(s.slab_from_minor), to: Number(s.slab_to_minor) }))
    .filter((r) => r.from !== fromMinor);
}

/** True when the inclusive range [fromMinor, toMinor] overlaps another slab of the state. */
export function slabOverlaps(
  input: Pick<PtSlabInput, "stateCode" | "fromMinor" | "toMinor">,
  existing: readonly ExistingPtSlab[],
): boolean {
  return otherSlabs(input.stateCode, input.fromMinor, existing).some(
    (r) => input.fromMinor <= r.to && r.from <= input.toMinor,
  );
}

/**
 * Gaps (in paise) that would exist in the state's slab chain AFTER saving this
 * slab: consecutive slabs where the next starts more than one paisa after the
 * previous ends. Not an error (a state may legitimately leave a band at nil
 * tax) -- surfaced as a warning in the confirm dialog.
 */
export function slabGaps(
  input: Pick<PtSlabInput, "stateCode" | "fromMinor" | "toMinor">,
  existing: readonly ExistingPtSlab[],
): Array<{ fromMinor: number; toMinor: number }> {
  const all = [...otherSlabs(input.stateCode, input.fromMinor, existing), { from: input.fromMinor, to: input.toMinor }]
    .sort((a, b) => a.from - b.from);
  const gaps: Array<{ fromMinor: number; toMinor: number }> = [];
  for (let i = 1; i < all.length; i++) {
    const prev = all[i - 1]!;
    const next = all[i]!;
    if (next.from > prev.to + 1) gaps.push({ fromMinor: prev.to + 1, toMinor: next.from - 1 });
  }
  return gaps;
}

export type PtSlabIssue = "state" | "range" | "overlap" | "amount";

/** First blocking problem with a slab, or null. `field` is the form control to focus. */
export function validatePtSlab(
  raw: { stateCode: string; fromMinor: number; toMinor: number; taxMinor: number; effectiveFrom?: string },
  existing: readonly ExistingPtSlab[],
): { issue: PtSlabIssue; field: "stateCode" | "slabTo" | "ptAmount" } | null {
  const parsed = ptSlabInput.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0]!;
    const key = first.path[0];
    if (key === "stateCode") return { issue: "state", field: "stateCode" };
    if (key === "taxMinor") return { issue: "amount", field: "ptAmount" };
    return { issue: "range", field: "slabTo" };
  }
  if (slabOverlaps(parsed.data, existing)) return { issue: "overlap", field: "slabTo" };
  return null;
}
