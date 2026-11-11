import { financeDdo } from "./schema.js";

type DdoWriter = { insert: (t: typeof financeDdo) => { values: (v: unknown) => { onConflictDoNothing: (o: unknown) => Promise<unknown> } } };

/** The DDO code finance.bill.create falls back to when neither the bill nor the tenant config names one. */
export const DEFAULT_DDO_CODE = "DDO000001";

/**
 * Seed the tenant's default Drawing & Disbursing Officer. Idempotent (a DDO the tenant already has, under whatever
 * name, is left untouched). Must run in a transaction scoped to `tenantId` (RLS). The tenant admin replaces the name
 * and adds the real DDO through POST /v1/finance/ddo.
 */
export async function seedDefaultDdoTx(tx: unknown, tenantId: string, actorId: string): Promise<void> {
  await (tx as DdoWriter).insert(financeDdo)
    .values({
      tenantId, ddoCode: DEFAULT_DDO_CODE, name: "Drawing and Disbursing Officer (Head Office)", isActive: true,
      createdBy: actorId, updatedBy: actorId,
    })
    .onConflictDoNothing({ target: [financeDdo.tenantId, financeDdo.ddoCode] });
}
