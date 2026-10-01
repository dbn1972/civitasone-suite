import { z } from "zod";

/**
 * GAP-PAYROLL-FLEX-BENEFITS-01: wire shape of GET /v1/payroll/flex-benefits/plans
 * (payroll.flex_benefit_plans rows), validated at the boundary. Money stays
 * in paise as a decimal STRING so it can cross the server -> client
 * component boundary unchanged; client code converts with BigInt().
 */
const minorString = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((v) => String(v));

const planRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  fy: z.string().transform((v) => v.trim()),
  total_budget_minor: minorString,
  components: z.array(z.object({ name: z.string(), maxMinor: minorString, taxExempt: z.boolean().optional() })),
});

export type FlexPlan = {
  id: string;
  name: string;
  fy: string;
  totalBudgetMinor: string;
  components: Array<{ name: string; maxMinor: string; taxExempt: boolean }>;
};

/** Rows that fail validation are dropped, never guessed at. */
export function mapFlexPlans(payload: unknown): FlexPlan[] | null {
  const rows = Array.isArray(payload) ? payload : (payload as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return null;
  const plans: FlexPlan[] = [];
  for (const row of rows) {
    const parsed = planRowSchema.safeParse(row);
    if (!parsed.success) continue;
    plans.push({
      id: parsed.data.id,
      name: parsed.data.name,
      fy: parsed.data.fy,
      totalBudgetMinor: parsed.data.total_budget_minor,
      components: parsed.data.components.map((c) => ({ name: c.name, maxMinor: c.maxMinor, taxExempt: c.taxExempt ?? false })),
    });
  }
  return plans;
}
