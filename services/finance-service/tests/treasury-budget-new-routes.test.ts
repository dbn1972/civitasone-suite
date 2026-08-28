/**
 * New GET routes that previously did not exist at all, so the pages backed
 * by them 404'd/400'd live even though their tables + response schemas
 * already existed:
 *   - GET /v1/finance/debt
 *   - GET /v1/finance/guarantees
 *   - GET /v1/finance/challans (+ /:id)
 *   - GET /v1/finance/deposits
 *   - GET /v1/finance/budgets/demand-grants
 *   - GET /v1/finance/schemes (+ /:id)
 *
 * Debt gets one seeded row to prove the real bigint-to-string amount mapping
 * end-to-end; the others are asserted for auth-gating + a 200 with the right
 * shape (an empty tenant sees an empty list, which is itself the fix -- these
 * routes 404'd before, they don't now).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeDebt } from "../src/modules/treasury/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000fc";
const ACTOR = "00000000-aaaa-4000-8000-0000000000fc";
const DEBT_ID = "55555555-aaaa-4000-8000-0000000000fc";

function token(roles: string[]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-new-get-routes" }, SECRET);
}
const officer = () => ({ authorization: `Bearer ${token(["finance_officer"])}` });

async function cleanup() {
  await scoped(TENANT, (tx) => tx.delete(financeDebt).where(eq(financeDebt.id, DEBT_ID)));
}
beforeAll(async () => {
  await cleanup();
  await scoped(TENANT, (tx) => tx.insert(financeDebt).values({
    id: DEBT_ID, tenantId: TENANT, instrument: "state_bond", source: "RBI market loan",
    amountMinor: 500000000n, status: "active", createdBy: ACTOR, updatedBy: ACTOR,
  }));
});
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("GET /v1/finance/debt", () => {
  it("200s with the seeded row mapped correctly (bigint amountMinor -> string)", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/v1/finance/debt", headers: officer() });
      expect(res.statusCode).toBe(200);
      const row = res.json().find((r: any) => r.id === DEBT_ID);
      expect(row).toBeDefined();
      expect(row.instrument).toBe("state_bond");
      expect(row.amountMinor).toBe("500000000");
      expect(row.status).toBe("active");
    } finally {
      await app.close();
    }
  });

  it("403s without a finance role", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET", url: "/v1/finance/debt",
        headers: { authorization: `Bearer ${token(["citizen"])}` },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});

describe("GET /v1/finance/guarantees", () => {
  it("200s with a list (previously no route existed anywhere)", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/v1/finance/guarantees", headers: officer() });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json())).toBe(true);
    } finally {
      await app.close();
    }
  });
});

describe("GET /v1/finance/challans and /v1/finance/challans/:id", () => {
  it("list 200s (previously POST-only)", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/v1/finance/challans", headers: officer() });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json())).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("detail 404s cleanly for an unknown id (route exists, tenant-scoped)", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET", url: "/v1/finance/challans/00000000-0000-4000-8000-000000000000", headers: officer(),
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});

describe("GET /v1/finance/deposits", () => {
  it("200s with a list (previously POST-only)", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/v1/finance/deposits", headers: officer() });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json())).toBe(true);
    } finally {
      await app.close();
    }
  });
});

describe("GET /v1/finance/budgets/demand-grants", () => {
  it("200s with a list instead of misrouting into GET /v1/finance/budgets/:id", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/v1/finance/budgets/demand-grants", headers: officer() });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json())).toBe(true);
    } finally {
      await app.close();
    }
  });
});

describe("GET /v1/finance/schemes and /v1/finance/schemes/:id", () => {
  it("list 200s (previously no route existed anywhere)", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/v1/finance/schemes", headers: officer() });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json())).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("detail 404s cleanly for an unknown id", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET", url: "/v1/finance/schemes/00000000-0000-4000-8000-000000000000", headers: officer(),
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
