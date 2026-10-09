/**
 * NEW-001 (FF-06, D-66) — the PATCH /v1/finance/bills/:id/approve route
 * pre-check (synchronous, mirrors the reject route's toDomain(err, 409)).
 *
 * Proves:
 *   - 404 NOT_FOUND for an unknown id, and for a bill that belongs to ANOTHER
 *     tenant (tenant-scoped read: never leaked as "not approvable");
 *   - 409 BILL_NOT_APPROVABLE for a non-'pending' bill (here: 'rejected');
 *   - 409 STAGE_TERMINAL for a bill already at the final 'pay' stage;
 *   - 403 for a caller whose roles are outside APPROVER_ROLES;
 *   - 202 for a valid, 'pending'/'section' bill;
 *   - a 4xx never changes the bill's state (the refusal is before any publish).
 *
 * Uses the real route via buildApp().inject() against real Postgres, exactly
 * like bill-reject-status-guard.test.ts's HTTP block.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeBills } from "../src/modules/payments/schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-00000000f604";
const OTHER_TENANT = "aaaaaaaa-1111-4000-8000-00000000f699";
const MAKER  = "00000000-aaaa-4000-8000-00000000f604";
const CHECKER = "00000000-bbbb-4000-8000-00000000f604";
const VENDOR = "f6040000-aaaa-4000-8000-000000000001";
const HEAD   = "f6040000-bbbb-4000-8000-000000000001";
const HEAD_O = "f6040000-bbbb-4000-8000-000000000002";

const BILL_REJECTED = "f6040000-cccc-4000-8000-000000000001";
const BILL_PAY      = "f6040000-cccc-4000-8000-000000000002";
const BILL_PENDING  = "f6040000-cccc-4000-8000-000000000003";
const BILL_OTHER    = "f6040000-cccc-4000-8000-000000000004"; // belongs to OTHER_TENANT
const UNKNOWN       = "f6040000-cccc-4000-8000-0000000000ff";
const ALL = [BILL_REJECTED, BILL_PAY, BILL_PENDING, BILL_OTHER];

function token(roles: string[], tid = TENANT) {
  return signToken({ sub: CHECKER, tid, roles, sid: "sess-f604" }, SECRET);
}

async function seedHeads() {
  await scoped(TENANT, (tx) => tx.insert(financeHeads).values({
    id: HEAD, tenantId: TENANT, code: "4704-F604", name: "NEW-001 Route Head", level: 2, createdBy: MAKER, updatedBy: MAKER,
  }).onConflictDoNothing());
  await scoped(OTHER_TENANT, (tx) => tx.insert(financeHeads).values({
    id: HEAD_O, tenantId: OTHER_TENANT, code: "4704-F699", name: "NEW-001 Route Head (other)", level: 2, createdBy: MAKER, updatedBy: MAKER,
  }).onConflictDoNothing());
}

function seedBill(id: string, status: string, stage: string, tenantId = TENANT, headId = HEAD) {
  return scoped(tenantId, (tx) => tx.insert(financeBills).values({
    id, tenantId, billNo: `BILL-${id.slice(-8)}`, vendorId: VENDOR, headId,
    grossMinor: 500000n, netMinor: 500000n, currency: "INR", deductions: [],
    poRef: "po-f604", grnRef: "grn-f604",
    stage, status, createdBy: MAKER, updatedBy: MAKER, version: 1,
  }));
}

async function readBill(id: string, tenantId = TENANT) {
  const rows = await scoped(tenantId, (tx) => tx.select().from(financeBills).where(eq(financeBills.id, id)));
  return rows[0];
}

async function clean() {
  for (const id of ALL) {
    await scoped(TENANT, (tx) => tx.delete(financeBills).where(eq(financeBills.id, id)));
    await scoped(OTHER_TENANT, (tx) => tx.delete(financeBills).where(eq(financeBills.id, id)));
  }
}

async function approve(id: string, roles: string[] = ["accounts_officer"]) {
  const app = await buildApp();
  try {
    return await app.inject({
      method: "PATCH", url: `/v1/finance/bills/${id}/approve`,
      headers: { authorization: `Bearer ${token(roles)}`, "content-type": "application/json" },
      payload: {},
    });
  } finally {
    await app.close();
  }
}

beforeEach(async () => { await clean(); await seedHeads(); });
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("NEW-001 approve route pre-check (synchronous 4xx before any publish)", () => {
  it("404 for an unknown bill id", async () => {
    const res = await approve(UNKNOWN);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("404 for a bill that belongs to another tenant (tenant-scoped read, not leaked)", async () => {
    await seedBill(BILL_OTHER, "pending", "section", OTHER_TENANT, HEAD_O);
    const res = await approve(BILL_OTHER); // caller is in TENANT, bill is in OTHER_TENANT
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
    // the other tenant's bill is untouched
    const bill = await readBill(BILL_OTHER, OTHER_TENANT);
    expect(bill?.status).toBe("pending");
    expect(bill?.stage).toBe("section");
  });

  it("409 BILL_NOT_APPROVABLE for a 'rejected' bill, and never changes it", async () => {
    await seedBill(BILL_REJECTED, "rejected", "section");
    const res = await approve(BILL_REJECTED);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("BILL_NOT_APPROVABLE");
    const bill = await readBill(BILL_REJECTED);
    expect(bill?.status).toBe("rejected");
    expect(bill?.stage).toBe("section");
  });

  it("409 STAGE_TERMINAL for a bill already at the 'pay' stage, and never changes it", async () => {
    await seedBill(BILL_PAY, "passed", "pay");
    const res = await approve(BILL_PAY);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("STAGE_TERMINAL");
    const bill = await readBill(BILL_PAY);
    expect(bill?.status).toBe("passed");
    expect(bill?.stage).toBe("pay");
  });

  it("403 for a caller outside APPROVER_ROLES", async () => {
    await seedBill(BILL_PENDING, "pending", "section");
    const res = await approve(BILL_PENDING, ["finance_officer"]); // not an approver role
    expect(res.statusCode).toBe(403);
    const bill = await readBill(BILL_PENDING);
    expect(bill?.status).toBe("pending");
    expect(bill?.stage).toBe("section");
  });

  it("202 for a valid 'pending'/'section' bill", async () => {
    await seedBill(BILL_PENDING, "pending", "section");
    const res = await approve(BILL_PENDING);
    expect(res.statusCode).toBe(202);
    // sendAccepted returns the flat accepted envelope { id, status:"accepted", correlationId }.
    expect(res.json().status).toBe("accepted");
    expect(res.json().id).toBe(BILL_PENDING);
  });
});
