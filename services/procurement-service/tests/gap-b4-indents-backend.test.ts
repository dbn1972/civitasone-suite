/**
 * Batch-4 gap backend coverage (route family /procurement/indents):
 *   GAP-PROCUREMENT-INDENTS-05       — department-scoped list (least-privilege)
 *   GAP-PROCUREMENT-INDENTS-DETAIL-05 — detail serializer shape (purpose + trail)
 *   GAP-PROCUREMENT-INDENTS-NEW-04   — server allocates a gapless number; client indentNo optional
 *   GAP-PROCUREMENT-INDENTS-NEW-06   — GFR mode-bands thresholds + server re-derivation; value/mode mismatch rejected
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementIndents } from "../src/modules/indent/schema.js";
import { docCounters, allocateDocNo } from "../src/shared/numbering.js";
import * as queries from "../src/modules/indent/queries.js";
import { createIndentBody } from "../src/modules/indent/validators.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "b4b4b4b4-1111-4000-8000-000000000001";
const ACTOR = "b4b4b4b4-2222-4000-8000-000000000002";

let app: FastifyInstance;

function wideToken(): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["procurement_officer", "super_admin"], sid: "s" }, SECRET, 3600);
}

const DEPT_A = "Housing & Urban Development";
const DEPT_B = "Finance";

async function seedIndent(id: string, department: string, indentNo: string): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(procurementIndents).values({
    id, tenantId: TENANT, indentNo, department,
    purpose: "Batch-4 backend test fixture", totalMinor: 100000n, committedMinor: 0n,
    currency: "INR", status: "pending", indentDate: "2026-09-01",
    createdBy: ACTOR, updatedBy: ACTOR,
  })));
}

async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(procurementIndents).where(eq(procurementIndents.tenantId, TENANT));
    await tx.delete(docCounters).where(eq(docCounters.tenantId, TENANT));
  }));
}

beforeAll(async () => {
  app = await buildApp();
  await wipe();
  await seedIndent("b4000000-0000-4000-8000-00000000000a", DEPT_A, "IND-B4-A1");
  await seedIndent("b4000000-0000-4000-8000-00000000000b", DEPT_A, "IND-B4-A2");
  await seedIndent("b4000000-0000-4000-8000-00000000000c", DEPT_B, "IND-B4-B1");
});

afterAll(async () => {
  await wipe();
  await app.close();
  await sqlClient.end();
});

describe("GAP-PROCUREMENT-INDENTS-05 — department-scoped list", () => {
  it("a department scope returns only that department's indents", async () => {
    const scoped = await runWithTenant(TENANT, () => queries.listIndents(TENANT, 50, 0, DEPT_A));
    expect(scoped.length).toBe(2);
    expect(scoped.every((r) => r.department === DEPT_A)).toBe(true);
  });

  it("no scope (a wide reader) returns every department's indents", async () => {
    const all = await runWithTenant(TENANT, () => queries.listIndents(TENANT, 50, 0));
    const depts = new Set(all.map((r) => r.department));
    expect(depts.has(DEPT_A)).toBe(true);
    expect(depts.has(DEPT_B)).toBe(true);
  });

  it("a department with no indents returns no rows (the fence never leaks another department)", async () => {
    const none = await runWithTenant(TENANT, () => queries.listIndents(TENANT, 50, 0, "Department With No Indents"));
    expect(none).toHaveLength(0);
  });
});

describe("indent list status filter is a SQL predicate (pages over matching rows)", () => {
  it("limit 1 + status=approved returns the approved indent even though pending rows exist", async () => {
    const id = "b4000000-0000-4000-8000-0000000000aa";
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(procurementIndents).values({
      id, tenantId: TENANT, indentNo: "IND-B4-APPROVED", department: DEPT_B,
      purpose: "approved fixture", totalMinor: 100000n, committedMinor: 0n,
      currency: "INR", status: "approved", indentDate: "2026-09-01",
      createdBy: ACTOR, updatedBy: ACTOR,
    })));
    const page = await runWithTenant(TENANT, () => queries.listIndents(TENANT, 1, 0, undefined, "approved"));
    expect(page).toHaveLength(1);
    expect(page[0]!.id).toBe(id);
    const none = await runWithTenant(TENANT, () => queries.listIndents(TENANT, 50, 0, undefined, "no_such_status"));
    expect(none).toHaveLength(0);
  });
});

describe("GAP-PROCUREMENT-INDENTS-DETAIL-05 — detail serializer shape", () => {
  it("returns the indent's purpose and a well-formed (array) approvalTrail", async () => {
    const detail = await runWithTenant(TENANT, () => queries.getIndent("b4000000-0000-4000-8000-00000000000a", TENANT));
    expect(detail).not.toBeNull();
    expect(detail!.purpose).toBe("Batch-4 backend test fixture");
    expect(Array.isArray(detail!.approvalTrail)).toBe(true);
    // Trail steps, when present, must carry actor/action/timestamp — asserted
    // structurally so a future populated trail is validated, not just [].
    for (const step of detail!.approvalTrail as Array<Record<string, unknown>>) {
      expect(typeof step.actor).toBe("string");
      expect(typeof step.action).toBe("string");
      expect(typeof step.timestamp).toBe("string");
    }
  });
});

describe("GAP-PROCUREMENT-INDENTS-NEW-04 — server-allocated gapless number", () => {
  it("allocateDocNo issues gapless sequential indent numbers for a tenant", async () => {
    const period = "2099"; // isolated period so this test owns the counter
    const n1 = await runWithTenant(TENANT, () => db.transaction((tx) => allocateDocNo(tx, TENANT, "indent", period)));
    const n2 = await runWithTenant(TENANT, () => db.transaction((tx) => allocateDocNo(tx, TENANT, "indent", period)));
    const n3 = await runWithTenant(TENANT, () => db.transaction((tx) => allocateDocNo(tx, TENANT, "indent", period)));
    expect(n1).toBe("IND/2099/0001");
    expect(n2).toBe("IND/2099/0002");
    expect(n3).toBe("IND/2099/0003");
  });

  it("the create body accepts a payload WITHOUT a client indentNo (server allocates it)", () => {
    const ok = createIndentBody.safeParse({
      department: "IT", purpose: "Replenish stock",
      items: [{ itemCode: "A", description: "d", quantity: 1, unit: "nos", unitPriceMinor: 1000 }],
    });
    expect(ok.success).toBe(true);
  });

  it("still rejects an explicitly empty indentNo", () => {
    const bad = createIndentBody.safeParse({
      indentNo: "", department: "IT", purpose: "Replenish stock",
      items: [{ itemCode: "A", description: "d", quantity: 1, unit: "nos", unitPriceMinor: 1000 }],
    });
    expect(bad.success).toBe(false);
  });
});

describe("GAP-PROCUREMENT-INDENTS-NEW-06 — GFR mode-bands server-side", () => {
  it("GET /gfr/mode-bands returns the band table and re-derives applicableMode for a value", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/procurement/gfr/mode-bands?estimatedValueMinor=25000000", // Rs 2,50,000
      headers: { authorization: `Bearer ${wideToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    // thresholds present as strings (bigint-safe)
    expect(body.data[0]).toHaveProperty("thresholdMaxMinor");
    // Rs 2,50,000 is above the Rs 25,000 direct-purchase ceiling -> not "DP".
    expect(typeof body.applicableMode).toBe("string");
    expect(body.applicableMode).not.toBe("DP");
  });

  it("POST create rejects a procurement mode that violates the value band (GFR floor)", async () => {
    // Rs 1,00,00,000 (above the limited-tender ceiling) with mode=direct_purchase
    // must be refused synchronously, before the create is queued.
    const res = await app.inject({
      method: "POST",
      url: "/v1/procurement/indents",
      headers: { authorization: `Bearer ${wideToken()}`, "content-type": "application/json" },
      payload: {
        department: "IT", purpose: "Over-value direct purchase (should fail GFR)",
        procurementMode: "direct_purchase",
        items: [{ itemCode: "BIG", description: "Server", quantity: 1, unit: "nos", unitPriceMinor: 1000000000 }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toMatch(/GFR_MODE_NOT_ALLOWED/);
  });
});
