/**
 * masters/fy-routes.ts — POST /v1/finance/opening-balances integrity guard.
 *
 * Proves the route-level half of the fix: a direct API call with an
 * unbalanced entry set (the exact bypass the client's own "fail closed"
 * check could not prevent) is now rejected synchronously with a clear 400,
 * instead of being accepted (202) and silently corrupting the FY's opening
 * trial balance. See masters-opening-balance-consumer.test.ts for the
 * non-bypassable consumer-side copy of the same check.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { scoped } from "./_tenant.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000b1";
const ACTOR = "00000000-aaaa-4000-8000-0000000000b1";

function token(roles: string[]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-opening-balance" }, SECRET);
}
const financeAdmin = () => ({ authorization: `Bearer ${token(["finance_admin"])}` });

const HEADS = ["1100", "3100"].map((code, i) => ({
  id: `bbbbbbbb-2222-4000-8000-0000000000b${i + 1}`, tenantId: TENANT, code, name: `Head ${code}`, level: 1,
  classification: i === 0 ? "asset" : "equity", createdBy: ACTOR, updatedBy: ACTOR,
}));
async function cleanup() {
  await scoped(TENANT, (tx) => tx.delete(financeHeads).where(eq(financeHeads.tenantId, TENANT)));
  await scoped(TENANT, (tx) => tx.execute(sql`DELETE FROM gl.finance_fiscal_years WHERE tenant_id = ${TENANT}::uuid`));
}
beforeAll(async () => {
  await cleanup();
  // GAP-FINANCE-OPENING-BALANCES-03/-06: the route now needs a real chart of accounts, and refuses a closed FY.
  await scoped(TENANT, (tx) => tx.insert(financeHeads).values(HEADS));
  await scoped(TENANT, (tx) => tx.execute(sql`
    INSERT INTO gl.finance_fiscal_years (id, tenant_id, code, label, start_date, end_date, status, created_by)
    VALUES (gen_random_uuid(), ${TENANT}::uuid, '2026-27', 'FY 2026-27', '2026-04-01', '2027-03-31', 'active', ${ACTOR}::uuid),
           (gen_random_uuid(), ${TENANT}::uuid, '2024-25', 'FY 2024-25', '2024-04-01', '2025-03-31', 'closed', ${ACTOR}::uuid)`));
});
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("POST /v1/finance/opening-balances — server-side balance enforcement", () => {
  it("rejects an unbalanced entry set with 400 OPENING_BALANCE_UNBALANCED", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST", url: "/v1/finance/opening-balances", headers: financeAdmin(),
        payload: {
          fyCode: "2026-27",
          reason: "Migration opening position per audited TB",
          entries: [
            { accountCode: "1100", debitMinor: 100000, creditMinor: 0 },
            { accountCode: "3100", debitMinor: 0, creditMinor: 90000 },
          ],
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("OPENING_BALANCE_UNBALANCED");
    } finally {
      await app.close();
    }
  });

  it("rejects a single-entry set as too few entries, even when unbalanced", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST", url: "/v1/finance/opening-balances", headers: financeAdmin(),
        payload: { fyCode: "2026-27", reason: "Migration opening position per audited TB", entries: [{ accountCode: "1100", debitMinor: 500, creditMinor: 0 }] },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("OPENING_BALANCE_TOO_FEW_ENTRIES");
    } finally {
      await app.close();
    }
  });

  it("rejects a single-entry set even when it trivially balances against itself", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST", url: "/v1/finance/opening-balances", headers: financeAdmin(),
        payload: { fyCode: "2026-27", reason: "Migration opening position per audited TB", entries: [{ accountCode: "1100", debitMinor: 500, creditMinor: 500 }] },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("OPENING_BALANCE_TOO_FEW_ENTRIES");
    } finally {
      await app.close();
    }
  });

  it("still accepts a balanced entry set (regression: the guard must not block legitimate submissions)", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST", url: "/v1/finance/opening-balances", headers: financeAdmin(),
        payload: {
          fyCode: "2026-27",
          reason: "Migration opening position per audited TB",
          entries: [
            { accountCode: "1100", debitMinor: 250000, creditMinor: 0 },
            { accountCode: "3100", debitMinor: 0, creditMinor: 250000 },
          ],
        },
      });
      expect(res.statusCode).toBe(202);
      expect(res.json().status).toBe("accepted");
      expect(res.json().count).toBe(2);
    } finally {
      await app.close();
    }
  });

  it("requires finance_admin/super_admin -- a reader role is forbidden regardless of balance", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST", url: "/v1/finance/opening-balances",
        headers: { authorization: `Bearer ${token(["audit_officer"])}` },
        payload: { fyCode: "2026-27", reason: "Migration opening position per audited TB", entries: [{ accountCode: "1100", debitMinor: 1, creditMinor: 1 }] },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});

describe("POST /v1/finance/opening-balances — closed FY and chart-of-accounts enforcement (server side)", () => {
  const balanced = (a: string, b: string) => [
    { accountCode: a, debitMinor: 1000, creditMinor: 0 },
    { accountCode: b, debitMinor: 0, creditMinor: 1000 },
  ];
  async function post(fyCode: string, entries: unknown[]) {
    const app = await buildApp();
    try {
      return await app.inject({
        method: "POST", url: "/v1/finance/opening-balances", headers: financeAdmin(),
        payload: { fyCode, reason: "Migration opening position per audited TB", entries },
      });
    } finally { await app.close(); }
  }

  it("409 FISCAL_YEAR_CLOSED for a closed fiscal year", async () => {
    const res = await post("2024-25", balanced("1100", "3100"));
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("FISCAL_YEAR_CLOSED");
  });

  it("400 ACCOUNT_NOT_FOUND for a code that is not in the tenant chart of accounts, naming the code", async () => {
    const res = await post("2026-27", balanced("1100", "9X99"));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("ACCOUNT_NOT_FOUND");
    expect(res.json().message).toContain("9X99");
  });

  it("202 for an active FY with known codes", async () => {
    const res = await post("2026-27", balanced("1100", "3100"));
    expect(res.statusCode).toBe(202);
  });
});
