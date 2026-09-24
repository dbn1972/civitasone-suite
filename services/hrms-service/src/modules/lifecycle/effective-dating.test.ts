/**
 * Bug 1 regression tests — effective-dating enforcement (migration 0144).
 *
 * Live-DB integration tests: the scenario under test genuinely spans
 * multiple independent consumers (lifecycle/consumer.ts, employee/consumer.ts,
 * promotion-eoffice-consumer.ts, eoffice-consumer.ts) plus the new scheduler
 * tick (lifecycle/effective-scheduler.ts), each importing `db` from
 * shared/db.js independently — mocking that boundary convincingly for a
 * genuinely multi-step "not applied today, applied once due" scenario would
 * mean reimplementing real WHERE/version/RLS semantics by hand. Same choice
 * scheduler/tick.test.ts already made for this exact module.
 *
 * Tenant context: hrms_employees/hrms_promotions/hrms_transfers all have
 * FORCE ROW LEVEL SECURITY (tenant_id = employee.current_tenant_id()), and
 * this service's connecting role (hrms_svc) has no BYPASSRLS — confirmed
 * empirically that even a bare db.insert()/db.select() outside an explicit
 * db.transaction() is rejected/sees nothing regardless of runWithTenant.
 * Every direct DB access below therefore goes through
 * runWithTenant(tenantId, () => db.transaction(tx => ...)), and every
 * consumer-driven write goes through a queue wrapped the same way
 * production's queue-service does (see wireTenantAwareQueue below — mirrors
 * admin-service/tests/admin.test.ts's identical helper).
 *
 * hrms_employees.departmentId/designationId carry no FK (migrations
 * 0036/0038 are index-only — "FK-style lookup column, no covering index
 * found"), so a fresh random UUID works for both without seeding reference
 * data. hrms_promotions/hrms_transfers FK to hrms_employees(id) ON DELETE
 * CASCADE (migration 0028), so deleting the one seeded employee at the end
 * of each test removes everything it produced in those two tables.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { hrmsEmployees, type EmployeeRow } from "../employee/schema.js";
import { hrmsPromotions, hrmsTransfers, type PromotionRow, type TransferRow } from "./schema.js";
import { registerLifecycleMutationConsumers } from "./consumer.js";
import { registerPromotionEOfficeConsumers } from "./promotion-eoffice-consumer.js";
import { registerEOfficeDecisionConsumers } from "./eoffice-consumer.js";
import { registerEmployeeConsumers } from "../employee/consumer.js";
import { applyDueEffectiveChangesOnce } from "./effective-scheduler.js";
import { COMMANDS, CONSUMED_EVENTS } from "../../topics.js";

// Mirrors admin-service/tests/admin.test.ts's wireTenantAwareQueue: production
// wiring (queue-service's createQueue()) decorates subscribe() so every
// consumer handler runs inside runWithTenant(msg.tenantId, ...), which is
// what lets db.transaction() pick up the RLS GUC. A bare MemoryQueue in a
// test does not do this on its own.
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function futureDateISO(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

async function buildQueue(): Promise<MemoryQueue> {
  const q = new MemoryQueue({ maxAttempts: 1 });
  wireTenantAwareQueue(q);
  registerLifecycleMutationConsumers(q);
  registerPromotionEOfficeConsumers(q);
  registerEOfficeDecisionConsumers(q);
  registerEmployeeConsumers(q); // also self-wraps via tenantScoped(); harmless to double-wrap
  await q.start();
  return q;
}

interface Seeded {
  tenantId: string;
  employeeId: string;
  actorId: string;
  departmentId: string;
  fromDesigId: string;
}

async function seedEmployee(): Promise<Seeded> {
  const tenantId = randomUUID();
  const employeeId = randomUUID();
  const actorId = randomUUID();
  const departmentId = randomUUID();
  const fromDesigId = randomUUID();
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.insert(hrmsEmployees).values({
      id: employeeId, tenantId,
      employeeNo: `EFD-${employeeId.slice(0, 8)}`,
      fullName: "Effective Dating Test Employee",
      departmentId, designationId: fromDesigId,
      dateOfJoining: "2020-01-01",
      basicMinor: 5_000_000n,
      status: "confirmed",
      createdBy: actorId, updatedBy: actorId,
    });
  }));
  return { tenantId, employeeId, actorId, departmentId, fromDesigId };
}

async function cleanupEmployee(tenantId: string, employeeId: string): Promise<void> {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.id, employeeId));
  }));
}

async function getEmployee(tenantId: string, employeeId: string): Promise<EmployeeRow | undefined> {
  return runWithTenant(tenantId, () => db.transaction(async (tx) => {
    const [row] = await tx.select().from(hrmsEmployees).where(eq(hrmsEmployees.id, employeeId));
    return row;
  }));
}

async function getPromotion(tenantId: string, promotionId: string): Promise<PromotionRow | undefined> {
  return runWithTenant(tenantId, () => db.transaction(async (tx) => {
    const [row] = await tx.select().from(hrmsPromotions).where(eq(hrmsPromotions.id, promotionId));
    return row;
  }));
}

async function getTransfer(tenantId: string, transferId: string): Promise<TransferRow | undefined> {
  return runWithTenant(tenantId, () => db.transaction(async (tx) => {
    const [row] = await tx.select().from(hrmsTransfers).where(eq(hrmsTransfers.id, transferId));
    return row;
  }));
}

describe("Bug 1 — effective-dating enforcement (migration 0144)", () => {
  it("direct promotion, effectiveDate 30 days out: does NOT change the employee today; DOES change it once the scheduler tick reaches that date", async () => {
    const { tenantId, employeeId, actorId, fromDesigId } = await seedEmployee();
    try {
      const toDesigId = randomUUID();
      const promotionId = randomUUID();
      const effectiveDate = futureDateISO(30);

      const q = await buildQueue();
      await q.publish(COMMANDS.lifecyclePromotionCreate, {
        messageId: randomUUID(), type: COMMANDS.lifecyclePromotionCreate,
        tenantId, actorId, correlationId: randomUUID(), schemaVersion: "1.0",
        payload: {
          id: promotionId, tenantId, employeeId, fromDesigId, toDesigId,
          effectiveDate, newBasicMinor: 6_000_000,
        },
      });
      await q.drain();

      // Not applied today.
      const before = await getEmployee(tenantId, employeeId);
      expect(before?.designationId).toBe(fromDesigId);
      expect(before?.basicMinor).toBe(5_000_000n);
      const promoBefore = await getPromotion(tenantId, promotionId);
      expect(promoBefore?.status).toBe("pending_effective");

      // Simulate the scheduler tick reaching the effective date.
      const result = await applyDueEffectiveChangesOnce(db, { asOf: effectiveDate });
      expect(result.promotionsFailed).toBe(0);

      // Now applied.
      const after = await getEmployee(tenantId, employeeId);
      expect(after?.designationId).toBe(toDesigId);
      expect(after?.basicMinor).toBe(6_000_000n);
      const promoAfter = await getPromotion(tenantId, promotionId);
      expect(promoAfter?.status).toBe("completed");
    } finally {
      await cleanupEmployee(tenantId, employeeId);
    }
  });

  it("direct promotion, effectiveDate today: applies immediately — no behaviour change for the common case", async () => {
    const { tenantId, employeeId, actorId, fromDesigId } = await seedEmployee();
    try {
      const toDesigId = randomUUID();
      const promotionId = randomUUID();

      const q = await buildQueue();
      await q.publish(COMMANDS.lifecyclePromotionCreate, {
        messageId: randomUUID(), type: COMMANDS.lifecyclePromotionCreate,
        tenantId, actorId, correlationId: randomUUID(), schemaVersion: "1.0",
        payload: { id: promotionId, tenantId, employeeId, fromDesigId, toDesigId, effectiveDate: todayISO() },
      });
      await q.drain();

      const after = await getEmployee(tenantId, employeeId);
      expect(after?.designationId).toBe(toDesigId);
      const promo = await getPromotion(tenantId, promotionId);
      expect(promo?.status).toBe("completed");
    } finally {
      await cleanupEmployee(tenantId, employeeId);
    }
  });

  it("direct transfer, effectiveDate 15 days out: does NOT change the employee today; DOES change it once due (also proves the removed invalid status: \"transferred\" write no longer rolls back the transaction)", async () => {
    const { tenantId, employeeId, actorId, departmentId } = await seedEmployee();
    try {
      const toDeptId = randomUUID();
      const effectiveDate = futureDateISO(15);
      const messageId = randomUUID();

      const q = await buildQueue();
      await q.publish(COMMANDS.employeeTransfer, {
        messageId, type: COMMANDS.employeeTransfer,
        tenantId, actorId, correlationId: randomUUID(), schemaVersion: "1.0",
        payload: { employeeId, tenantId, fromDeptId: departmentId, toDeptId, effectiveDate },
      });
      await q.drain();

      const before = await getEmployee(tenantId, employeeId);
      expect(before?.departmentId).toBe(departmentId);
      const transferBefore = await getTransfer(tenantId, messageId);
      expect(transferBefore?.status).toBe("pending_effective");

      const result = await applyDueEffectiveChangesOnce(db, { asOf: effectiveDate });
      expect(result.transfersFailed).toBe(0);

      const after = await getEmployee(tenantId, employeeId);
      expect(after?.departmentId).toBe(toDeptId);
      const transferAfter = await getTransfer(tenantId, messageId);
      expect(transferAfter?.status).toBe("completed");
    } finally {
      await cleanupEmployee(tenantId, employeeId);
    }
  });

  it("eOffice-approved promotion, effectiveDate 45 days out: stays pending_effective through the approval, applies once the scheduler tick reaches that date", async () => {
    const { tenantId, employeeId, actorId, fromDesigId } = await seedEmployee();
    try {
      const toDesigId = randomUUID();
      const promotionId = randomUUID();
      const effectiveDate = futureDateISO(45);

      const q = await buildQueue();
      await q.publish(COMMANDS.employeePromotionSubmitApproval, {
        messageId: randomUUID(), type: COMMANDS.employeePromotionSubmitApproval,
        tenantId, actorId, correlationId: randomUUID(), schemaVersion: "1.0",
        payload: { id: promotionId, employeeId, tenantId, fromDesigId, toDesigId, effectiveDate },
      });
      await q.drain();

      await q.publish(CONSUMED_EVENTS.promotionFileDecided, {
        messageId: randomUUID(), type: CONSUMED_EVENTS.promotionFileDecided,
        tenantId, actorId, correlationId: randomUUID(), schemaVersion: "1.0",
        payload: {
          fileId: randomUUID(), fileNo: "EFD-F1", refType: "hr_promotion", refId: promotionId,
          decision: "approved", decidedBy: actorId, decidedAt: new Date().toISOString(),
        },
      });
      await q.drain();

      const promoAfterApproval = await getPromotion(tenantId, promotionId);
      expect(promoAfterApproval?.status).toBe("pending_effective");
      const empAfterApproval = await getEmployee(tenantId, employeeId);
      expect(empAfterApproval?.designationId).toBe(fromDesigId);

      const result = await applyDueEffectiveChangesOnce(db, { asOf: effectiveDate });
      expect(result.promotionsFailed).toBe(0);

      const empAfterTick = await getEmployee(tenantId, employeeId);
      expect(empAfterTick?.designationId).toBe(toDesigId);
      const promoAfterTick = await getPromotion(tenantId, promotionId);
      expect(promoAfterTick?.status).toBe("completed");
    } finally {
      await cleanupEmployee(tenantId, employeeId);
    }
  });

  it("eOffice-approved transfer, effectiveDate today: applies immediately — no scheduler tick needed", async () => {
    const { tenantId, employeeId, actorId, departmentId } = await seedEmployee();
    try {
      const toDeptId = randomUUID();
      const transferId = randomUUID();

      const q = await buildQueue();
      await q.publish(COMMANDS.employeeTransferSubmitApproval, {
        messageId: randomUUID(), type: COMMANDS.employeeTransferSubmitApproval,
        tenantId, actorId, correlationId: randomUUID(), schemaVersion: "1.0",
        payload: { id: transferId, employeeId, tenantId, fromDeptId: departmentId, toDeptId, effectiveDate: todayISO() },
      });
      await q.drain();

      await q.publish(CONSUMED_EVENTS.transferFileDecided, {
        messageId: randomUUID(), type: CONSUMED_EVENTS.transferFileDecided,
        tenantId, actorId, correlationId: randomUUID(), schemaVersion: "1.0",
        payload: {
          fileId: randomUUID(), fileNo: "EFD-F2", refType: "hr_transfer", refId: transferId,
          decision: "approved", decidedBy: actorId, decidedAt: new Date().toISOString(),
        },
      });
      await q.drain();

      const after = await getEmployee(tenantId, employeeId);
      expect(after?.departmentId).toBe(toDeptId);
      const transfer = await getTransfer(tenantId, transferId);
      expect(transfer?.status).toBe("completed");
    } finally {
      await cleanupEmployee(tenantId, employeeId);
    }
  });
});
