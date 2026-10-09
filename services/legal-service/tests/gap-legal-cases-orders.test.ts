import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { legalCases } from "../src/modules/cases/schema.js";
import { legalOrders } from "../src/modules/hearings/schema.js";

/**
 * GAP-LEGAL-CASES-NEW-03: POSTing a case with an existing (tenant, caseNo)
 * returns 409 DUPLICATE_CASE_NO rather than a 202 that silently fails in the
 * async consumer against the UNIQUE (tenant_id, case_no) constraint.
 *
 * GAP-LEGAL-COURT-ORDERS-01: the court-orders list exposes orderType so the
 * web Type column shows the real order type (judgment, stay, …) instead of a
 * complianceRequired-derived label.
 */

const JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "11111111-aaaa-4000-8000-000000000042";
const ACTOR = "00000000-aaaa-4000-8000-000000000042";
const CASE_1 = "22222222-bbbb-4000-8000-000000000042";
const ORDER_1 = "33333333-cccc-4000-8000-000000000042";

function makeToken(roles: string[]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-test" }, JWT_SECRET, 3600);
}

async function buildApp() {
  const { buildApp } = await import("../src/app.js");
  return buildApp();
}

beforeAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(legalOrders).where(eq(legalOrders.tenantId, TENANT));
    await tx.delete(legalCases).where(eq(legalCases.tenantId, TENANT));
    await tx.insert(legalCases).values({
      id: CASE_1, tenantId: TENANT, caseNo: "WP/DUP/2026",
      title: "Dup test", court: "High Court", status: "pending",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(legalOrders).values({
      id: ORDER_1, tenantId: TENANT, caseId: CASE_1,
      orderType: "judgment", summary: "Final judgment", orderDate: "2026-02-01",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
});

afterAll(async () => { await sqlClient.end(); });

describe("create case duplicate handling (GAP-LEGAL-CASES-NEW-03)", () => {
  it("returns 409 DUPLICATE_CASE_NO for an existing case number", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/legal/cases",
      headers: { authorization: `Bearer ${makeToken(["legal_officer"])}`, "x-tenant-id": TENANT },
      payload: { caseNo: "WP/DUP/2026", title: "Another", court: "High Court" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("DUPLICATE_CASE_NO");
    await app.close();
  });

  it("accepts a fresh case number (202)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/legal/cases",
      headers: { authorization: `Bearer ${makeToken(["legal_officer"])}`, "x-tenant-id": TENANT },
      payload: { caseNo: "WP/FRESH/2026", title: "Fresh", court: "High Court" },
    });
    expect(res.statusCode).toBe(202);
    await app.close();
  });
});

describe("court-orders list exposes orderType (GAP-LEGAL-COURT-ORDERS-01)", () => {
  it("includes the recorded orderType on each summary row", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/legal/court-orders",
      headers: { authorization: `Bearer ${makeToken(["legal_officer"])}`, "x-tenant-id": TENANT },
    });
    expect(res.statusCode).toBe(200);
    // GAP2-LEGAL-COURT-ORDERS-10: the list is now a paged envelope
    // ({ items, total, limit, offset, stats }) rather than a bare array, so the
    // compliance KPIs can be computed server-side over the full set. The row
    // shape (incl. orderType) is unchanged; it just lives under `items`.
    const body = res.json() as { items: Array<{ id: string; orderType?: string }> };
    const rows = body.items;
    const row = rows.find((r) => r.id === ORDER_1);
    expect(row?.orderType).toBe("judgment");
    await app.close();
  });
});
