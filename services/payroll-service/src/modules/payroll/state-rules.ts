/**
 * POST /v1/payroll/statutory/state-rules — request contract and slab checks.
 *
 * GAP-PAYROLL-STATUTORY-PT-03: PT slabs are inclusive ranges in paise
 * ([fromMinor, toMinor], see the KA seed in 0005_world_class_payroll.sql:
 * 0–1500000 then 1500001–…). Each posted slab is upserted on its own
 * (tenant, state, slab_from) key, so a one-slab POST never deletes the
 * state's other slabs; overlapping ranges are rejected instead of silently
 * stored.
 *
 * GAP-PAYROLL-STATUTORY-LWF-02: LWF frequency is now settable. When a field
 * is omitted the stored value is preserved (the consumer COALESCEs), so a
 * POST that only carries the contribution amounts can no longer reset the
 * frequency or zero the other party's contribution.
 */
import { z } from "zod";

export const LWF_FREQUENCIES = ["monthly", "quarterly", "half_yearly", "yearly"] as const;
export type LwfFrequency = (typeof LWF_FREQUENCIES)[number];

const ptSlab = z.object({
  fromMinor: z.number().int().nonnegative(),
  toMinor: z.number().int().nonnegative(),
  taxMinor: z.number().int().nonnegative(),
}).refine((s) => s.toMinor >= s.fromMinor, { message: "toMinor must be >= fromMinor", path: ["toMinor"] });

export const stateRulesBody = z.object({
  stateCode: z.string().min(2).max(4),
  ptSlabs: z.array(ptSlab).max(50).optional(),
  lwfEmployee: z.number().int().nonnegative().optional(),
  lwfEmployer: z.number().int().nonnegative().optional(),
  lwfFrequency: z.enum(LWF_FREQUENCIES).optional(),
});
export type StateRulesBody = z.infer<typeof stateRulesBody>;

type Range = { fromMinor: number; toMinor: number };

const overlaps = (a: Range, b: Range): boolean => a.fromMinor <= b.toMinor && b.fromMinor <= a.toMinor;

/**
 * Returns a human-readable description of the first overlap found, or null.
 * An existing slab with the same `fromMinor` as an incoming one is the row
 * that incoming slab will update (upsert key), so it is excluded from the
 * comparison.
 */
export function findPtSlabOverlap(incoming: Range[], existing: Range[]): string | null {
  for (let i = 0; i < incoming.length; i++) {
    const a = incoming[i]!;
    for (let j = i + 1; j < incoming.length; j++) {
      const b = incoming[j]!;
      if (a.fromMinor === b.fromMinor) {
        return `two slabs in the request start at ${a.fromMinor}`;
      }
      if (overlaps(a, b)) {
        return `slab ${a.fromMinor}-${a.toMinor} overlaps slab ${b.fromMinor}-${b.toMinor} in the same request`;
      }
    }
  }
  const replacedFroms = new Set(incoming.map((s) => s.fromMinor));
  const kept = existing.filter((e) => !replacedFroms.has(e.fromMinor));
  for (const a of incoming) {
    const hit = kept.find((e) => overlaps(a, e));
    if (hit) {
      return `slab ${a.fromMinor}-${a.toMinor} overlaps existing slab ${hit.fromMinor}-${hit.toMinor}`;
    }
  }
  return null;
}
