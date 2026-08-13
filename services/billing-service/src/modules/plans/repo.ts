import { eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { billingPlans, type BillingPlanInsert } from "./schema.js";
import type { PlanView } from "./domain.js";

// Platform plans are stored under the system tenant — use its context for reads
const SET_SYSTEM_TENANT = sql.raw(`SET LOCAL "app.tenant_id" = '00000000-0000-0000-0000-000000000000'`);

function toView(r: typeof billingPlans.$inferSelect): PlanView {
  return { id: r.id, name: r.name, code: r.code, priceMinor: r.priceMinor.toString(), currency: r.currency, govtExempt: r.govtExempt, active: r.active };
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function list(): Promise<PlanView[]> {
  const rows = await db.transaction(async (tx) => {
    await tx.execute(SET_SYSTEM_TENANT);
    return tx.select().from(billingPlans).where(eq(billingPlans.active, true));
  });
  return rows.map(toView);
}

export async function findById(id: string): Promise<PlanView | null> {
  const rows = await db.transaction(async (tx) => {
    await tx.execute(SET_SYSTEM_TENANT);
    return tx.select().from(billingPlans).where(eq(billingPlans.id, id)).limit(1);
  });
  return rows[0] ? toView(rows[0]) : null;
}

export async function insert(tx: Writer, row: BillingPlanInsert): Promise<void> {
  await tx.insert(billingPlans).values(row);
}
