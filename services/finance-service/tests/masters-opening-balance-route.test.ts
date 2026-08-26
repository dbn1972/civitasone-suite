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
import { describe, it, expect, afterAll } from "vitest";
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

afterAll(async () => { await sqlClient.end(); });

describe("POST /v1/finance/opening-balances — server-side balance enforcement", () => {
  it("rejects an unbalanced entry set with 400 OPENING_BALANCE_UNBALANCED", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST", url: "/v1/finance/opening-balances", headers: financeAdmin(),
        payload: {
          fyCode: "2026-27",
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
        payload: { fyCode: "2026-27", entries: [{ accountCode: "1100", debitMinor: 500, creditMinor: 0 }] },
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
        payload: { fyCode: "2026-27", entries: [{ accountCode: "1100", debitMinor: 500, creditMinor: 500 }] },
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
        payload: { fyCode: "2026-27", entries: [{ accountCode: "1100", debitMinor: 1, creditMinor: 1 }] },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});
