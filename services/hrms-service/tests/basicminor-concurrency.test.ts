/**
 * Concurrency regression test — hrms_employees.basicMinor optimistic
 * concurrency guard (fix/hrms-basicminor-optimistic-concurrency).
 *
 * CONTEXT: hrms_employees.basicMinor is written by several independent,
 * asynchronous consumers — the pay-matrix annual-increment consumer
 * (pay-matrix/f3-consumer.ts), the direct promotion consumer
 * (lifecycle/consumer.ts's lifecyclePromotionCreate), the eOffice-approved
 * promotion consumer (lifecycle/promotion-eoffice-consumer.ts), and the
 * generic employee-update consumer (employee/consumer.ts). Before this fix,
 * every one of them wrote basicMinor via an UNCONDITIONAL BLIND OVERWRITE —
 * no precondition on the row's prior state, and the `version` column
 * (declared on hrms_employees but, for this field, previously unused) was
 * never checked or bumped. If two of these consumers raced for the same
 * employee, whichever wrote last silently clobbered the other's pay change
 * with no error and no audit trail of the loss.
 *
 * This file proves the fix on a REAL Postgres (not mocked): every consumer
 * now reads {basicMinor, version} fresh inside its own transaction and
 * writes through employee/repo.ts's updateEmployeeVersioned, which adds a
 * `WHERE version = expectedVersion` precondition and bumps version
 * atomically with the write. A lost race never succeeds silently — it
 * throws, which the queue's own bounded retry (up to 5 attempts) and DLQ
 * take over from there.
 *
 * Scenario used throughout: a promotion (lifecyclePromotionCreate, an
 * unconditional "set basicMinor to X" write) racing a 7th-CPC annual
 * increment (pay-matrix's f3RouteWrite op pay_matrix_routes__0, a
 * conditional "move basicMinor from fromMinor to toMinor" write whose
 * precondition is the plan's own `fromMinor`, precomputed by the route
 * before this consumer ever runs).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { Queue, Handler, MemoryQueue } from "@civitasone/queue";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
import { registerLifecycleMutationConsumers } from "../src/modules/lifecycle/consumer.js";
import { registerF3_pay_matrix_Consumers } from "../src/modules/pay-matrix/f3-consumer.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";
import { hrmsServiceBookEntries } from "../src/modules/service-book/schema.js";
import { hrmsPromotions } from "../src/modules/lifecycle/schema.js";

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) => {
    rawSubscribe(topic, withTenantConsumer(handler) as Handler);
  }) as typeof q.subscribe;
  return q;
}
wireTenantAwareQueue(queue);
registerLifecycleMutationConsumers(queue);
registerF3_pay_matrix_Consumers(queue);

async function drain(): Promise<void> {
  await (queue as unknown as MemoryQueue).drain();
}

const TENANT = randomUUID();
const ACTOR = randomUUID();
const deptId = randomUUID();
const desigFrom = randomUUID();
const desigTo = randomUUID();

const SEED_BASIC_MINOR = 5610000n; // level-10 entry, matches pay-matrix's own fixture convention

async function seedEmployee(id: string): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(hrmsEmployees).values({
      id, tenantId: TENANT, employeeNo: `E-${id.slice(0, 8)}`, fullName: "Race Test Emp",
      departmentId: deptId, designationId: desigFrom, dateOfJoining: "2010-01-01",
      status: "confirmed", basicMinor: SEED_BASIC_MINOR, employeeType: "permanent",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
}

async function readEmployee(id: string): Promise<{ basicMinor: bigint; version: number; designationId: string }> {
  const rows = await runWithTenant(TENANT, () => db.select({
    basicMinor: hrmsEmployees.basicMinor, version: hrmsEmployees.version, designationId: hrmsEmployees.designationId,
  }).from(hrmsEmployees).where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, TENANT))).limit(1));
  const row = rows[0];
  if (!row) throw new Error(`employee ${id} not found`);
  return row;
}

async function hasIncrementServiceBookEntry(employeeId: string, effectiveDate: string): Promise<boolean> {
  const rows = await runWithTenant(TENANT, () => db.select({ id: hrmsServiceBookEntries.id }).from(hrmsServiceBookEntries)
    .where(and(
      eq(hrmsServiceBookEntries.tenantId, TENANT),
      eq(hrmsServiceBookEntries.employeeId, employeeId),
      eq(hrmsServiceBookEntries.effectiveDate, effectiveDate),
      eq(hrmsServiceBookEntries.entryType, "increment"),
    )));
  return rows.length > 0;
}

function publishPromotion(employeeId: string, newBasicMinor: bigint) {
  return queue.publish(COMMANDS.lifecyclePromotionCreate, {
    id: randomUUID(), type: COMMANDS.lifecyclePromotionCreate,
    tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
    payload: {
      id: randomUUID(), tenantId: TENANT, employeeId,
      fromDesigId: desigFrom, toDesigId: desigTo,
      effectiveDate: "2026-04-01", newBasicMinor: newBasicMinor.toString(),
    },
  });
}

function publishIncrement(employeeId: string, fromMinor: bigint, toMinor: bigint, effectiveDate: string) {
  return queue.publish(COMMANDS.f3RouteWrite, {
    id: randomUUID(), type: COMMANDS.f3RouteWrite,
    tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
    payload: {
      op: "pay_matrix_routes__0", tenantId: TENANT, effectiveDate,
      plan: [{
        employeeId, level: 10, fromCell: 1, toCell: 2,
        fromMinor: fromMinor.toString(), toMinor: toMinor.toString(),
        description: "7th CPC annual increment",
      }],
    },
  });
}

beforeAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(hrmsDepartments).values([{ id: deptId, tenantId: TENANT, code: "D1", name: "Dept 1", createdBy: ACTOR, updatedBy: ACTOR }]);
    await tx.insert(hrmsDesignations).values([
      { id: desigFrom, tenantId: TENANT, code: "JR", name: "Junior", level: 10, createdBy: ACTOR, updatedBy: ACTOR },
      { id: desigTo, tenantId: TENANT, code: "SR", name: "Senior", level: 11, createdBy: ACTOR, updatedBy: ACTOR },
    ]);
  }));
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(hrmsServiceBookEntries).where(eq(hrmsServiceBookEntries.tenantId, TENANT));
    await tx.delete(hrmsPromotions).where(eq(hrmsPromotions.tenantId, TENANT));
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
    await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, TENANT));
    await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, TENANT));
  }));
  await sqlClient.end();
});

describe("hrms_employees.basicMinor — optimistic concurrency across independent consumers", () => {
  it("sequential: a promotion after a successful increment builds on it, doesn't lose it", async () => {
    const empId = randomUUID();
    await seedEmployee(empId);

    await publishIncrement(empId, SEED_BASIC_MINOR, 5800000n, "2026-04-01");
    await drain();
    const afterIncrement = await readEmployee(empId);
    expect(afterIncrement.basicMinor).toBe(5800000n); // increment applied
    expect(afterIncrement.version).toBe(2); // version bumped by the guarded write
    expect(await hasIncrementServiceBookEntry(empId, "2026-04-01")).toBe(true);

    await publishPromotion(empId, 6200000n);
    await drain();
    const afterPromotion = await readEmployee(empId);
    expect(afterPromotion.basicMinor).toBe(6200000n); // promotion applied on top, not a blind stomp of a stale value
    expect(afterPromotion.version).toBe(3);
    expect(afterPromotion.designationId).toBe(desigTo);
  });

  it("sequential: an increment computed against a now-stale fromMinor is rejected, not silently applied over a promotion", async () => {
    const empId = randomUUID();
    await seedEmployee(empId);

    // Promotion lands first (simulating it winning a race).
    await publishPromotion(empId, 6500000n);
    await drain();
    expect((await readEmployee(empId)).basicMinor).toBe(6500000n);

    // The increment's plan was computed BEFORE the promotion (fromMinor is
    // the original seed value) — by the time this consumer runs, that
    // precondition no longer holds.
    await publishIncrement(empId, SEED_BASIC_MINOR, 5900000n, "2026-05-01");
    await drain();

    const after = await readEmployee(empId);
    // The stale increment must NOT have silently overwritten the promotion's
    // pay change — basicMinor stays exactly what the promotion set.
    expect(after.basicMinor).toBe(6500000n);
    expect(after.version).toBe(2); // no successful write from the increment
    expect(await hasIncrementServiceBookEntry(empId, "2026-05-01")).toBe(false); // rolled back with the rejected write

    // The loser is NOT silently discarded: it is dead-lettered for manual review.
    const dlq = (queue as unknown as MemoryQueue).dlq;
    const found = dlq.find((d) => {
      const payload = d.msg.payload as { plan?: Array<{ employeeId?: string }> };
      return payload.plan?.some((item) => item.employeeId === empId);
    });
    expect(found).toBeDefined();
    expect(found?.error).toMatch(/STALE_INCREMENT_PLAN|version|basicMinor/i);
  });

  it("TRUE CONCURRENCY: a promotion and an increment fired together for the same employee — neither is silently lost", async () => {
    const empId = randomUUID();
    await seedEmployee(empId);

    const PROMOTION_BASIC = 6100000n;
    const INCREMENT_TO = 5750000n;

    // Fire both writes for the SAME employee back-to-back, with no await
    // between them — both are in flight concurrently (MemoryQueue schedules
    // delivery via setTimeout(0) and each handler runs its own real DB
    // transaction, so these genuinely interleave at the database level).
    const p1 = publishPromotion(empId, PROMOTION_BASIC);
    const p2 = publishIncrement(empId, SEED_BASIC_MINOR, INCREMENT_TO, "2026-06-01");
    await Promise.all([p1, p2]);
    await drain();

    const final = await readEmployee(empId);

    // INVARIANT 1: the final basicMinor is a value ONE of the two consumers
    // actually intended — never the original seed (both writes vanishing)
    // and never anything else. The promotion's write is an unconditional
    // "set to X" that always succeeds once it observes the row's current
    // version (retrying on conflict re-reads fresh), so in a two-writer
    // race it is deterministically the final value: the increment's write
    // is conditional on basicMinor still equalling its plan's fromMinor,
    // so it can only ever "win" by committing before the promotion's first
    // read — and once it does, the promotion's own retry observes THAT
    // state and still applies on top of it. Either way, basicMinor changed
    // and the final value is the promotion's.
    expect(final.basicMinor).toBe(PROMOTION_BASIC);
    expect(final.basicMinor).not.toBe(SEED_BASIC_MINOR);
    expect(final.version).toBeGreaterThan(1);

    // INVARIANT 2: the increment was never silently discarded. Either it
    // committed at some point (durable proof: its service-book entry, which
    // is never overwritten even though basicMinor later changed again), or
    // it permanently lost the race and is visibly dead-lettered.
    const incrementApplied = await hasIncrementServiceBookEntry(empId, "2026-06-01");
    const dlq = (queue as unknown as MemoryQueue).dlq;
    const incrementDeadLettered = dlq.some((d) => {
      const payload = d.msg.payload as { plan?: Array<{ employeeId?: string }> };
      return payload.plan?.some((item) => item.employeeId === empId);
    });
    expect(incrementApplied || incrementDeadLettered).toBe(true);
    // Never both — a commit is durable (service-book insert is in the same
    // transaction as the guarded update, so a later-failing attempt for a
    // DIFFERENT effectiveDate would be a different row; for this one
    // employeeId+effectiveDate pair it is one or the other, not neither.
    expect(incrementApplied && incrementDeadLettered).toBe(false);

    // INVARIANT 3: the promotion itself is durably recorded (its own audit
    // trail — hrms_promotions — never depends on winning or losing the
    // basicMinor race; only the basicMinor write does).
    const promoRows = await runWithTenant(TENANT, () => db.select({ id: hrmsPromotions.id }).from(hrmsPromotions)
      .where(and(eq(hrmsPromotions.tenantId, TENANT), eq(hrmsPromotions.employeeId, empId))));
    expect(promoRows.length).toBe(1);
  });
});
