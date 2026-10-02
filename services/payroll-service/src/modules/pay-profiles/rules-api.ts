/**
 * PAY-PROFILES: allowance-rule request schema, lock check and serialisation
 * shared by routes, commands and the consumer.
 */
import { z } from "zod";
import { sql } from "drizzle-orm";
import type { db } from "../../shared/db.js";
import type { AllowanceRules } from "./allowance-rules.js";

const minor = z.string().regex(/^\d{1,12}$/, "amount in paise as a digit string");

/** Latest YYYY-MM holding an approved/disbursed salary run (pensioner runs excluded), or null. */
export async function lockedThroughMonth(tx: Pick<typeof db, "execute">, tenantId: string): Promise<string | null> {
  const rows = (await tx.execute(sql`
    SELECT max(month) AS locked_through
    FROM payroll.payroll_runs
    WHERE tenant_id = ${tenantId}::uuid
      AND status IN ('approved', 'disbursed')
      AND run_type <> 'pensioner'
  `)) as unknown as Array<{ locked_through: string | null }>;
  return rows[0]?.locked_through ?? null;
}

export const createAllowanceRulesBody = z.object({
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-01$/, "must be the 1st of a month (YYYY-MM-01)"),
  hraFloorXMinor: minor.optional(),
  hraFloorYMinor: minor.optional(),
  hraFloorZMinor: minor.optional(),
  depSameStation: z.object({ rateBps: z.number().int().min(0).max(10000), capMinor: minor }).optional(),
  depOtherStation: z.object({ rateBps: z.number().int().min(0).max(10000), capMinor: minor }).optional(),
  changeReason: z.string().trim().min(10).max(500),
}).refine(
  (b) => b.hraFloorXMinor != null || b.hraFloorYMinor != null || b.hraFloorZMinor != null || b.depSameStation != null || b.depOtherStation != null,
  { message: "set at least one rule" },
);
export type CreateAllowanceRulesBody = z.infer<typeof createAllowanceRulesBody>;

export function serializeRules(r: AllowanceRules) {
  const dep = (d: AllowanceRules["deputation"]["same"]) => (d ? { rateBps: Number(d.rateBps), capMinor: d.capMinor.toString() } : null);
  return {
    hraFloorMinor: { X: r.hraFloorMinor.X.toString(), Y: r.hraFloorMinor.Y.toString(), Z: r.hraFloorMinor.Z.toString() },
    deputation: { sameStation: dep(r.deputation.same), otherStation: dep(r.deputation.other) },
    sources: r.sources,
  };
}

