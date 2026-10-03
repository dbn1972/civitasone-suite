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

/**
 * GAP-PAYROLL-FLEX-BENEFITS-05: election lifecycle. The API only ever writes
 * these three; anything else is rendered as raw text with StatusPill's
 * neutral/info default rather than crashing.
 */
export const FLEX_ELECTION_STATUSES = ["submitted", "approved", "rejected"] as const;
export type FlexElectionStatus = (typeof FLEX_ELECTION_STATUSES)[number];

const queueRowSchema = z.object({
  id: z.string(),
  employee_name: z.string().nullable().optional(),
  plan_name: z.string(),
  fy: z.string().transform((v) => v.trim()),
  total_elected_minor: minorString,
  status: z.string(),
  etag: z.string(),
  is_own_submission: z.boolean().optional(),
});

export type PendingFlexElection = {
  id: string;
  employeeName: string | null;
  planName: string;
  fy: string;
  totalElectedMinor: string;
  status: string;
  /** What the reviewer saw; sent with the decision so an edited election is rejected (409 STALE_ELECTION). */
  etag: string;
  isOwnSubmission: boolean;
};

export type PendingFlexElections = { rows: PendingFlexElection[]; total: number };

/** GET /v1/payroll/flex-benefits/elections -> approver queue. Invalid rows are dropped; a non-conforming payload is null (-> error state). */
export function mapPendingElections(payload: unknown): PendingFlexElections | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { data?: unknown; total?: unknown };
  if (!Array.isArray(p.data)) return null;
  const rows: PendingFlexElection[] = [];
  for (const raw of p.data) {
    const parsed = queueRowSchema.safeParse(raw);
    if (!parsed.success) continue;
    rows.push({
      id: parsed.data.id,
      employeeName: parsed.data.employee_name ?? null,
      planName: parsed.data.plan_name,
      fy: parsed.data.fy,
      totalElectedMinor: parsed.data.total_elected_minor,
      status: parsed.data.status,
      etag: parsed.data.etag,
      isOwnSubmission: parsed.data.is_own_submission ?? false,
    });
  }
  const total = typeof p.total === "number" && Number.isFinite(p.total) ? p.total : rows.length;
  return { rows, total };
}
