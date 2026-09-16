/**
 * COMP-007 -- finance-service `audit` module (CAG/AG/internal audit paragraphs)
 * smoke test.
 *
 * Registered as a route only (GET /v1/finance/audit-paras, GET .../:id) but had
 * zero real test references anywhere in the service. Note: `audit-module.test.ts`
 * elsewhere in this tests/ directory is NOT pre-existing coverage for this
 * module -- it fully vi.mock()s `../src/shared/db.js` and covers a different
 * concern (the `audit.event.record` envelope contract emitted by OTHER
 * consumers, e.g. budget's). `eft-initiate-tx-scope.test.ts` and
 * `integration-procurement-bill.test.ts` also touch "audit" only by
 * vi.mock()ing `../src/modules/audit/repo.js` away as a dependency stub while
 * testing unrelated flows. Confirmed by grepping the whole service for any
 * reference to `audit-paras`, `modules/audit/`, `financeAuditParas`, or
 * `auditRoutes` outside the module's own source: none of the three exercises
 * this module's real routes/repo against a real DB.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeAuditParas } from "../src/modules/audit/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = "aaaaaaaa-1111-4000-8000-000000000700";
const TENANT_B = "aaaaaaaa-1111-4000-8000-000000000701";
const ACTOR = "00000000-aaaa-4000-8000-000000000700";

const PARA_OPEN_A = "14141414-aaaa-4000-8000-000000000001";
const PARA_ESCALATED_A = "14141414-aaaa-4000-8000-000000000002";
const PARA_B = "14141414-bbbb-4000-8000-000000000001";

function token(roles: string[] = ["finance_officer"], tid = TENANT_A) {
  return signToken({ sub: "user-comp007-audit", tid, roles, sid: "sess-comp007-audit" }, SECRET);
}

async function wipe() {
  await scoped(TENANT_A, (tx) => tx.delete(financeAuditParas).where(eq(financeAuditParas.id, PARA_OPEN_A)));
  await scoped(TENANT_A, (tx) => tx.delete(financeAuditParas).where(eq(financeAuditParas.id, PARA_ESCALATED_A)));
  await scoped(TENANT_B, (tx) => tx.delete(financeAuditParas).where(eq(financeAuditParas.id, PARA_B)));
}

beforeAll(async () => {
  await wipe();
  await scoped(TENANT_A, (tx) =>
    tx.insert(financeAuditParas).values({
      id: PARA_OPEN_A,
      tenantId: TENANT_A,
      paraNo: "CAG-2026-011",
      source: "CAG",
      dept: "Public Works",
      moneyValueMinor: 5_00_000n,
      status: "open",
      createdBy: ACTOR,
      updatedBy: ACTOR,
    }),
  );
  await scoped(TENANT_A, (tx) =>
    tx.insert(financeAuditParas).values({
      id: PARA_ESCALATED_A,
      tenantId: TENANT_A,
      paraNo: "AG-2026-004",
      source: "AG",
      dept: "Revenue",
      moneyValueMinor: 12_50_000n,
      status: "escalated",
      createdBy: ACTOR,
      updatedBy: ACTOR,
    }),
  );
  // Different tenant entirely -- must never appear in tenant A's list/detail responses.
  await scoped(TENANT_B, (tx) =>
    tx.insert(financeAuditParas).values({
      id: PARA_B,
      tenantId: TENANT_B,
      paraNo: "CAG-2026-999",
      source: "CAG",
      dept: "Other Tenant Dept",
      moneyValueMinor: 9_99_999n,
      status: "open",
      createdBy: ACTOR,
      updatedBy: ACTOR,
    }),
  );
});

afterAll(async () => {
  await wipe();
  await sqlClient.end();
});

describe("COMP-007: audit -- GET /v1/finance/audit-paras", () => {
  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/finance/audit-paras" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role outside the reader ACL", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/audit-paras",
      headers: { authorization: `Bearer ${token(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("allows the audit_officer reader role (not just finance_officer/admin)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/audit-paras",
      headers: { authorization: `Bearer ${token(["audit_officer"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns only this tenant's paras, serialized with money as a string", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/audit-paras",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    const ids = data.map((r: any) => r.id);
    expect(ids).toContain(PARA_OPEN_A);
    expect(ids).toContain(PARA_ESCALATED_A);
    expect(ids).not.toContain(PARA_B); // tenant B's row must never leak into tenant A's list
    const openRow = data.find((r: any) => r.id === PARA_OPEN_A);
    expect(openRow.moneyValueMinor).toBe("500000");
    expect(typeof openRow.moneyValueMinor).toBe("string");
  });

  it("filters by status", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/audit-paras?status=escalated",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.every((r: any) => r.status === "escalated")).toBe(true);
    expect(data.map((r: any) => r.id)).toContain(PARA_ESCALATED_A);
  });

  it("rejects a status value outside the DB check constraint", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/audit-paras?status=not_a_real_status",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("COMP-007: audit -- GET /v1/finance/audit-paras/:id", () => {
  it("returns 404 for an id that does not exist", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/finance/audit-paras/${randomUUID()}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 (not another tenant's row) when the id belongs to a different tenant", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/finance/audit-paras/${PARA_B}`,
      headers: { authorization: `Bearer ${token()}` }, // tenant A's token
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 200 with the full row for a valid same-tenant id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/finance/audit-paras/${PARA_OPEN_A}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(PARA_OPEN_A);
    expect(body.paraNo).toBe("CAG-2026-011");
    expect(body.source).toBe("CAG");
    expect(body.version).toBe(1);
  });
});
