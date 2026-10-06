/**
 * GAP-ESTAB batch 4 — DB-backed query + cancel-consumer tests.
 *
 * Proves at the DB level:
 *  - getQuarterSummary returns correct total + byStatus (QUARTERS-01)
 *  - listAllotments filters by quarterId and enriches quarterNo (DETAIL-01 / ALLOTMENTS-01)
 *  - getAllotment returns a single enriched row or null (ALLOTMENTS-DETAIL-02)
 *  - quarterCancel consumer sets status=cancelled with reason (ALLOTMENTS-DETAIL-05)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { runWithTenant } from "@civitasone/db";
import { registerQuarterConsumers } from "../src/modules/quarters/consumer.js";
import * as queries from "../src/modules/quarters/queries.js";
import { estabQuarters, estabQuarterAllotments } from "../src/modules/quarters/schema.js";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const TENANT = "11111111-dddd-4000-8000-000000000001";
const ACTOR = "22222222-dddd-4000-8000-000000000001";
const EMPLOYEE = "33333333-dddd-4000-8000-000000000099";

const qVacant = randomUUID();
const qOccupied = randomUUID();
const qUnderRepair = randomUUID();
const allotmentId = randomUUID();

beforeAll(async () => {
  registerQuarterConsumers(queue);
  // Seed quarters directly — wrapped in runWithTenant so RLS allows the
  // writes (db.transaction auto-sets SET LOCAL app.tenant_id).
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(estabQuarters).values([
        { id: qVacant, tenantId: TENANT, quarterNo: "GAP-B-01", quarterType: "type_iv", status: "vacant", createdBy: ACTOR, updatedBy: ACTOR },
        { id: qOccupied, tenantId: TENANT, quarterNo: "GAP-B-02", quarterType: "type_iv", status: "occupied", createdBy: ACTOR, updatedBy: ACTOR },
        { id: qUnderRepair, tenantId: TENANT, quarterNo: "GAP-B-03", quarterType: "type_iv", status: "under_maintenance", createdBy: ACTOR, updatedBy: ACTOR },
      ]);
      await tx.insert(estabQuarterAllotments).values({
        id: allotmentId, tenantId: TENANT, quarterId: qOccupied, employeeRef: EMPLOYEE,
        payLevel: "10", status: "applied", createdBy: ACTOR, updatedBy: ACTOR,
      });
    }),
  );
});

afterAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(estabQuarterAllotments).where(eq(estabQuarterAllotments.tenantId, TENANT));
      await tx.delete(estabQuarters).where(eq(estabQuarters.tenantId, TENANT));
    }),
  );
});

describe("getQuarterSummary (QUARTERS-01)", () => {
  it("returns a total and per-status counts that reconcile", async () => {
    const summary = await runWithTenant(TENANT, () => queries.getQuarterSummary(TENANT));
    expect(summary.total).toBe(3);
    expect(summary.byStatus["vacant"]).toBe(1);
    expect(summary.byStatus["occupied"]).toBe(1);
    expect(summary.byStatus["under_maintenance"]).toBe(1);
    // total = sum of named + other
    const named = (summary.byStatus["vacant"] ?? 0) + (summary.byStatus["occupied"] ?? 0);
    const other = summary.total - named - (summary.byStatus["allotted"] ?? 0);
    expect(other).toBe(1); // the under_maintenance one
  });
});

describe("listAllotments quarterId filter + quarterNo enrichment (DETAIL-01 / ALLOTMENTS-01)", () => {
  it("filters by quarterId and resolves the quarter number", async () => {
    const { rows, total } = await runWithTenant(TENANT, () => queries.listAllotments(TENANT, { quarterId: qOccupied, limit: 50, offset: 0 }));
    expect(total).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].quarterId).toBe(qOccupied);
    expect(rows[0].quarterNo).toBe("GAP-B-02");
  });

  it("returns an empty set for a quarter with no allotments", async () => {
    const { rows, total } = await runWithTenant(TENANT, () => queries.listAllotments(TENANT, { quarterId: qVacant, limit: 50, offset: 0 }));
    expect(total).toBe(0);
    expect(rows).toHaveLength(0);
  });
});

describe("getAllotment by id (ALLOTMENTS-DETAIL-02)", () => {
  it("returns a single enriched allotment", async () => {
    const row = await runWithTenant(TENANT, () => queries.getAllotment(TENANT, allotmentId));
    expect(row).not.toBeNull();
    expect(row?.id).toBe(allotmentId);
    expect(row?.quarterNo).toBe("GAP-B-02");
  });

  it("returns null for an unknown id", async () => {
    const row = await runWithTenant(TENANT, () => queries.getAllotment(TENANT, randomUUID()));
    expect(row).toBeNull();
  });
});

describe("quarterCancel consumer (ALLOTMENTS-DETAIL-05)", () => {
  it("transitions an applied allotment to cancelled with the reason", async () => {
    await queue.publish("estab.quarter.cancel", {
      messageId: randomUUID(), type: "estab.quarter.cancel",
      tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: allotmentId, tenantId: TENANT, version: 1, cancelReason: "Ineligible on pay level" },
    });
    // Allow the in-memory consumer to process.
    await new Promise((r) => setTimeout(r, 150));
    const row = await runWithTenant(TENANT, () => queries.getAllotment(TENANT, allotmentId));
    expect(row?.status).toBe("cancelled");
    expect(row?.cancelReason).toBe("Ineligible on pay level");
  });
});
