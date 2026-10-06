/**
 * GAP-REVENUE-REFUNDS-02: "one live refund per receipt" is DB-enforced by the
 * partial unique index added in migrations/0014_refund_receipt_unique.sql, so
 * two concurrent refundCreate consumers cannot both insert. A REJECTED refund
 * does not block re-raising. DB-backed (DATABASE_URL); fails on a pre-0014 schema.
 */
import { describe, it, expect, afterAll } from "vitest";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const TENANT = "0000aaaa-0000-0000-0000-0000000005aa";
const ACTOR = "0000bbbb-0000-0000-0000-0000000005bb";
const ASSESSEE = "0000cccc-0000-0000-0000-000000000501";
const RECEIPT = "0000dddd-0000-0000-0000-000000000501";

async function insertRefund(status: string) {
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`
      INSERT INTO collection.refunds (tenant_id, receipt_id, assessee_id, amount_minor, reason, status, maker_user_id)
      VALUES (${TENANT}, ${RECEIPT}, ${ASSESSEE}, 1000, 'dup payment', ${status}, ${ACTOR})`;
  });
}

afterAll(async () => {
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM collection.refunds WHERE tenant_id = ${TENANT}`;
  });
  await sql.end();
});

describe("one live refund per receipt (GAP-REVENUE-REFUNDS-02, migration 0014)", () => {
  it("rejects a second live refund for the same receipt with 23505", async () => {
    await insertRefund("pending");
    let code: string | undefined;
    let constraint: string | undefined;
    try {
      await insertRefund("pending");
    } catch (err) {
      code = (err as { code?: string }).code;
      constraint = (err as { constraint_name?: string }).constraint_name;
    }
    expect(code).toBe("23505");
    expect(constraint).toBe("uq_refunds_tenant_receipt_live");
  });

  it("still allows re-raising once the earlier refund is rejected", async () => {
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`UPDATE collection.refunds SET status = 'rejected' WHERE tenant_id = ${TENANT} AND receipt_id = ${RECEIPT}`;
    });
    await expect(insertRefund("pending")).resolves.toBeUndefined();
  });
});
