/**
 * GAP2-FINANCE-RECURRING-ENTRIES-08 — GET /v1/finance/recurring-entries wire
 * contract.
 *
 * The listing used to `return reply.send({ data: rows })` with the raw
 * snake_case rows straight from tx.execute(), exposing internal
 * debit_account_id / credit_account_id UUIDs and created_by on the contract
 * and skipping response-schema validation. This test seeds one row and asserts
 * the response now carries ONLY the documented camelCase fields and that it is
 * shaped by the response schema. It fails on the old code (which returned the
 * internal columns) and passes after.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { RecurringEntryListResponseSchema } from "../src/modules/recurring/routes.js";
import { scoped } from "./_tenant.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "d4d4d4d4-5555-4000-8000-0000000000e5";

function token(roles: string[] = ["finance_officer"]) {
  return signToken({ sub: "e5e5e5e5-6666-4000-8000-0000000000f6", tid: TENANT, roles, sid: "sess-rec-001" }, SECRET);
}

const ROW_ID = randomUUID();
const DEBIT = randomUUID();
const CREDIT = randomUUID();
const CREATOR = randomUUID();

async function seed() {
  await scoped(TENANT, (tx) => tx.execute(sql`
    DELETE FROM gl.finance_recurring_entries WHERE tenant_id = ${TENANT}::uuid AND id = ${ROW_ID}::uuid
  `));
  await scoped(TENANT, (tx) => tx.execute(sql`
    INSERT INTO gl.finance_recurring_entries (
      id, tenant_id, name, voucher_type, frequency, debit_account_id, credit_account_id,
      amount_minor, narration, next_run_date, end_date, is_active, created_by
    ) VALUES (
      ${ROW_ID}::uuid, ${TENANT}::uuid, 'Monthly Rent', 'journal', 'monthly',
      ${DEBIT}::uuid, ${CREDIT}::uuid, 500000::bigint, 'office rent',
      '2026-09-01'::date, NULL, true, ${CREATOR}::uuid
    )
    ON CONFLICT (id) DO NOTHING
  `));
}

async function cleanup() {
  await scoped(TENANT, (tx) => tx.execute(sql`
    DELETE FROM gl.finance_recurring_entries WHERE tenant_id = ${TENANT}::uuid AND id = ${ROW_ID}::uuid
  `));
}

afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("GET /v1/finance/recurring-entries — serialized wire contract (GAP2-RECURRING-ENTRIES-08)", () => {
  it("returns only the documented camelCase fields and no internal columns", async () => {
    await seed();
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/recurring-entries",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const row = (body.data as Record<string, unknown>[]).find((r) => r.id === ROW_ID);
    expect(row).toBeTruthy();

    // The documented contract is present and camelCase.
    expect(row).toMatchObject({
      id: ROW_ID,
      name: "Monthly Rent",
      voucherType: "journal",
      frequency: "monthly",
      amountMinor: "500000",
      nextRunDate: "2026-09-01",
      endDate: null,
      isActive: true,
    });

    // The internal columns must NOT be exposed (this is what fails on old code).
    expect(row).not.toHaveProperty("debit_account_id");
    expect(row).not.toHaveProperty("credit_account_id");
    expect(row).not.toHaveProperty("created_by");
    expect(row).not.toHaveProperty("narration");
    expect(Object.keys(row as object).sort()).toEqual(
      ["amountMinor", "endDate", "frequency", "id", "isActive", "name", "nextRunDate", "voucherType"],
    );

    // And the whole payload satisfies the response schema.
    expect(() => RecurringEntryListResponseSchema.parse(body)).not.toThrow();
  });
});
