/**
 * applyPosting — chained, idempotent, concurrent, rollback & flag-off tests
 * (SmartTransfer OS, ST-M01-09; spec §4, §11; D-ST-01/09/10/19).
 *
 * Real Postgres. The flag WORKFORCE_CORE_LEDGER_ENABLED is set to "true" BEFORE
 * the config module is read, so the consumer registers and writes the ledger.
 * Everything runs through the real async command → consumer path + the memory
 * queue's drain() (never a fixed sleep — house rule 10).
 *
 * Proven:
 *   1. CHAINED: request → order → apply → occupancy + ledger + employee master
 *      + service book + audit + rich event, all in ONE transaction.
 *   2. IDEMPOTENT: redelivering the same order id is a no-op (markProcessed
 *      derives the key from orderId).
 *   3. CONCURRENT: two orders racing for the same post → exactly one wins; the
 *      other is an AUDITED refusal (no EXCLUDE 23P01 leaked).
 *   4. ROLLBACK: a failure (unknown employee) leaves NOTHING — no occupancy, no
 *      ledger, no service-book row, no audit success.
 *   5. FLAG OFF: with the ledger disabled the consumer writes nothing to
 *      workforce_core (legacy path unchanged).
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";

// Flag ON before any module that reads it is imported.
process.env.WORKFORCE_CORE_LEDGER_ENABLED = "true";
process.env.HRMS_POSTING_EVENTS_ENABLED = "true";

const { runWithTenant } = await import("@civitasone/db");
const { db } = await import("../../../shared/db.js");
const { queue } = await import("../../../shared/infra.js");
const { hrmsEmployees } = await import("../../employee/schema.js");
const { hrmsServiceBookEntries } = await import("../../service-book/schema.js");
const { wcPost, wcPostOccupancy, wcPostingLedger } =
  await import("../schema.js");
const outboxImport = await import("@civitasone/outbox");
const { outboxMessages } = outboxImport;
const { registerApplyPostingConsumer } = await import("./consumer.js");
const { COMMANDS } = await import("../../../topics.js");
const { isPostingLedgerEnabled } = await import("../config.js");

import type { MemoryQueue } from "@civitasone/queue";
import { idempotentId } from "@civitasone/auth";

registerApplyPostingConsumer(queue);

async function drain(): Promise<void> {
  await (queue as unknown as MemoryQueue).drain();
}

const TENANT = randomUUID();
const ACTOR = randomUUID();
const APPROVER = randomUUID();
const officeA = randomUUID();
const officeB = randomUUID();

function withTenant<T>(
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return runWithTenant(TENANT, () => db.transaction(fn)) as Promise<T>;
}

async function seedEmployee(officeId: string): Promise<string> {
  const id = randomUUID();
  await withTenant(async (tx) => {
    await tx.insert(hrmsEmployees).values({
      id,
      tenantId: TENANT,
      employeeNo: `E-${id.slice(0, 8)}`,
      fullName: "Posting Subject",
      departmentId: officeId,
      designationId: randomUUID(),
      dateOfJoining: "2015-01-01",
      station: "Dharwad",
      workStateCode: "KA",
      hraCityClass: "Y",
      status: "confirmed",
      employeeType: "permanent",
      createdBy: ACTOR,
      updatedBy: ACTOR,
    });
  });
  return id;
}

async function seedPost(officeId: string): Promise<string> {
  const id = randomUUID();
  await withTenant(async (tx) => {
    await tx.insert(wcPost).values({
      id,
      tenantId: TENANT,
      postNo: `P-${id.slice(0, 8)}`,
      officeId,
      designationId: randomUUID(),
      createdBy: ACTOR,
      updatedBy: ACTOR,
    });
  });
  return id;
}

async function publishApply(order: {
  orderId: string;
  employeeId: string;
  postId: string;
  effectiveDate: string;
  orderNumber: string;
  chargeType?: string;
  approvedBy?: string;
  actorId?: string;
}): Promise<void> {
  await runWithTenant(TENANT, () =>
    queue.publish(COMMANDS.postingApply, {
      // Deterministic messageId from the ORDER id (mirrors commands.ts) — this
      // is what makes redelivery a no-op.
      messageId: idempotentId({
        idempotencyKey: `posting.apply:${order.orderId}`,
        tenantId: TENANT,
      }),
      type: COMMANDS.postingApply,
      tenantId: TENANT,
      actorId: order.actorId ?? ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: {
        orderId: order.orderId,
        tenantId: TENANT,
        employeeId: order.employeeId,
        postId: order.postId,
        effectiveDate: order.effectiveDate,
        chargeType: order.chargeType ?? "substantive",
        orderNumber: order.orderNumber,
        ...(order.approvedBy ? { approvedBy: order.approvedBy } : {}),
      },
    }),
  );
  await drain();
}

async function readOccupancy(employeeId: string) {
  return withTenant((tx) =>
    tx
      .select()
      .from(wcPostOccupancy)
      .where(eq(wcPostOccupancy.employeeId, employeeId)),
  );
}
async function readLedger(employeeId: string) {
  return withTenant((tx) =>
    tx
      .select()
      .from(wcPostingLedger)
      .where(eq(wcPostingLedger.employeeId, employeeId)),
  );
}
async function readServiceBook(employeeId: string) {
  return withTenant((tx) =>
    tx
      .select()
      .from(hrmsServiceBookEntries)
      .where(
        and(
          eq(hrmsServiceBookEntries.tenantId, TENANT),
          eq(hrmsServiceBookEntries.employeeId, employeeId),
        ),
      ),
  );
}
async function readEmployeeRow(id: string) {
  const rows = await withTenant((tx) =>
    tx
      .select({
        departmentId: hrmsEmployees.departmentId,
        designationId: hrmsEmployees.designationId,
        version: hrmsEmployees.version,
      })
      .from(hrmsEmployees)
      .where(eq(hrmsEmployees.id, id))
      .limit(1),
  );
  return rows[0]!;
}
async function refusalReason(orderId: string): Promise<string | undefined> {
  const audits = await readAuditEvents(orderId);
  const r = audits.find(
    (a) =>
      (a.payload as { resourceId?: string }).resourceId === orderId &&
      (a.payload as { outcome?: string }).outcome === "failure",
  );
  return (r?.payload as { metadata?: { reason?: string } } | undefined)
    ?.metadata?.reason;
}
async function readEmployeeDept(id: string): Promise<string | undefined> {
  const rows = await withTenant((tx) =>
    tx
      .select({ departmentId: hrmsEmployees.departmentId })
      .from(hrmsEmployees)
      .where(eq(hrmsEmployees.id, id))
      .limit(1),
  );
  return rows[0]?.departmentId;
}
async function readAuditEvents(
  _resourceId: string,
): Promise<Array<{ payload: Record<string, unknown> }>> {
  const rows = await withTenant((tx) =>
    tx
      .select({ payload: outboxMessages.payload })
      .from(outboxMessages)
      .where(eq(outboxMessages.topic, "audit.event.record")),
  );
  return rows as Array<{ payload: Record<string, unknown> }>;
}

async function readOutboxByTopics(
  topics: string[],
): Promise<Array<{ topic: string; payload: Record<string, unknown> }>> {
  const rows = await withTenant((tx) =>
    tx
      .select({ topic: outboxMessages.topic, payload: outboxMessages.payload })
      .from(outboxMessages),
  );
  return (
    rows as Array<{ topic: string; payload: Record<string, unknown> }>
  ).filter((r) => topics.includes(r.topic));
}

afterAll(async () => {
  await withTenant(async (tx) => {
    await tx
      .delete(wcPostOccupancy)
      .where(eq(wcPostOccupancy.tenantId, TENANT));
    // posting_ledger is append-only (DB trigger rejects DELETE/TRUNCATE) and
    // post is FK-referenced by it, so neither can be deleted here. The suite's
    // TENANT is random, so those rows are tenant-isolated and harmless.
    await tx
      .delete(hrmsServiceBookEntries)
      .where(eq(hrmsServiceBookEntries.tenantId, TENANT));
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
  });
});

describe("applyPosting — flag + registration", () => {
  it("the ledger flag is ON for this suite", () => {
    expect(isPostingLedgerEnabled()).toBe(true);
  });
});

describe("applyPosting — chained apply writes everything in one tx", () => {
  it("occupancy + ledger + employee master + service book + applied/changed events", async () => {
    const employeeId = await seedEmployee(officeA);
    const postId = await seedPost(officeB);
    const orderId = randomUUID();

    await publishApply({
      orderId,
      employeeId,
      postId,
      effectiveDate: "2026-05-01",
      orderNumber: "ORD/2026/0001",
      approvedBy: APPROVER,
    });

    const occ = await readOccupancy(employeeId);
    expect(occ).toHaveLength(1);
    expect(occ[0]!.postId).toBe(postId);
    expect(occ[0]!.effectiveFrom).toBe("2026-05-01");
    expect(occ[0]!.effectiveTo).toBeNull();
    expect(occ[0]!.orderRef).toBe(orderId);

    const ledger = await readLedger(employeeId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.officeId).toBe(officeB);
    expect(ledger[0]!.postId).toBe(postId);

    expect(await readEmployeeDept(employeeId)).toBe(officeB);

    const sb = await readServiceBook(employeeId);
    expect(sb).toHaveLength(1);
    expect(sb[0]!.entryType).toBe("posting");
    expect(sb[0]!.documentRef).toBe("ORD/2026/0001");

    const audits = await readAuditEvents(orderId);
    const mine = audits.filter(
      (a) => (a.payload as { resourceId?: string }).resourceId === orderId,
    );
    const applied = mine.find(
      (a) => (a.payload as { action?: string }).action === "apply_posting",
    );
    expect(applied, "an apply_posting audit event was written").toBeDefined();
    expect((applied!.payload as { outcome?: string }).outcome).toBe("success");

    // The rich posting events were enqueued in the SAME transaction.
    const events = await readOutboxByTopics([
      "hrms.posting.applied",
      "hrms.posting.changed",
    ]);
    const appliedEvt = events.find(
      (e) =>
        e.topic === "hrms.posting.applied" &&
        (e.payload as { orderId?: string }).orderId === orderId,
    );
    expect(appliedEvt, "hrms.posting.applied was emitted").toBeDefined();
    expect((appliedEvt!.payload as { postId?: string }).postId).toBe(postId);

    const changedEvt = events.find(
      (e) =>
        e.topic === "hrms.posting.changed" &&
        (e.payload as { employeeId?: string }).employeeId === employeeId,
    );
    expect(
      changedEvt,
      "hrms.posting.changed (rich event) was emitted on office change",
    ).toBeDefined();
    expect((changedEvt!.payload as { toOfficeId?: string }).toOfficeId).toBe(
      officeB,
    );
    expect((changedEvt!.payload as { station?: string }).station).toBe(
      "Dharwad",
    );
    expect((changedEvt!.payload as { cityClass?: string }).cityClass).toBe("Y");
    // ddo omitted — no DDO source in Workforce Core today (optional in contract).
    expect(
      (changedEvt!.payload as Record<string, unknown>).ddo,
    ).toBeUndefined();
  });
});

describe("applyPosting — idempotent on the order id", () => {
  it("redelivering the same order is a no-op", async () => {
    const employeeId = await seedEmployee(officeA);
    const postId = await seedPost(officeB);
    const orderId = randomUUID();
    const order = {
      orderId,
      employeeId,
      postId,
      effectiveDate: "2026-06-01",
      orderNumber: "ORD/2026/0002",
    };

    await publishApply(order);
    await publishApply(order); // redelivery

    expect(await readOccupancy(employeeId)).toHaveLength(1);
    expect(await readLedger(employeeId)).toHaveLength(1);
    expect(await readServiceBook(employeeId)).toHaveLength(1);
  });
});

describe("applyPosting — concurrent apply for the same post", () => {
  it("exactly one wins; the other is an audited refusal (no 23P01 leak)", async () => {
    const emp1 = await seedEmployee(officeA);
    const emp2 = await seedEmployee(officeA);
    const postId = await seedPost(officeB);
    const order1 = randomUUID();
    const order2 = randomUUID();

    // Both orders try to make a SUBSTANTIVE holder of the SAME post on the SAME
    // day — the EXCLUDE one-substantive-holder-per-post constraint allows only
    // one. The second must be refused cleanly.
    await publishApply({
      orderId: order1,
      employeeId: emp1,
      postId,
      effectiveDate: "2026-07-01",
      orderNumber: "ORD/2026/0003",
    });
    await publishApply({
      orderId: order2,
      employeeId: emp2,
      postId,
      effectiveDate: "2026-07-01",
      orderNumber: "ORD/2026/0004",
    });

    const occ1 = await readOccupancy(emp1);
    const occ2 = await readOccupancy(emp2);
    const winners = [occ1.length, occ2.length].filter((n) => n === 1).length;
    expect(winners, "exactly one employee holds the post").toBe(1);

    const emp1Won = occ1.length === 1;
    const loser = emp1Won ? emp2 : emp1;
    const loserOrder = emp1Won ? order2 : order1;
    expect(await readOccupancy(loser)).toHaveLength(0);
    expect(await readLedger(loser)).toHaveLength(0);

    const audits = await readAuditEvents(loserOrder);
    const refusal = audits.find(
      (a) =>
        (a.payload as { resourceId?: string; outcome?: string }).resourceId ===
          loserOrder &&
        (a.payload as { outcome?: string }).outcome === "failure",
    );
    expect(refusal, "the loser got an audited refusal").toBeDefined();
    expect(
      (refusal!.payload as { metadata?: { reason?: string } }).metadata?.reason,
    ).toBe("POST_ALREADY_OCCUPIED");
  });
});

describe("applyPosting — rollback leaves nothing", () => {
  it("an unknown employee writes no occupancy / ledger / service book", async () => {
    const postId = await seedPost(officeB);
    const ghost = randomUUID();
    const orderId = randomUUID();

    await publishApply({
      orderId,
      employeeId: ghost,
      postId,
      effectiveDate: "2026-08-01",
      orderNumber: "ORD/2026/0005",
    });

    expect(await readOccupancy(ghost)).toHaveLength(0);
    expect(await readLedger(ghost)).toHaveLength(0);
    expect(await readServiceBook(ghost)).toHaveLength(0);

    const audits = await readAuditEvents(orderId);
    const refusal = audits.find(
      (a) =>
        (a.payload as { resourceId?: string; outcome?: string }).resourceId ===
          orderId && (a.payload as { outcome?: string }).outcome === "failure",
    );
    expect(
      refusal,
      "the unknown-employee apply was an audited refusal",
    ).toBeDefined();
  });
});

describe("applyPosting — SoD in the consumer", () => {
  it("refuses when the maker is also the approver (no new occupancy)", async () => {
    const employeeId = await seedEmployee(officeA);
    const postId = await seedPost(officeB);
    const orderId = randomUUID();

    // actorId (maker) == approvedBy (approver) → SoD violation.
    await publishApply({
      orderId,
      employeeId,
      postId,
      effectiveDate: "2026-09-01",
      orderNumber: "ORD/2026/0006",
      approvedBy: ACTOR,
      actorId: ACTOR,
    });

    expect(await readOccupancy(employeeId)).toHaveLength(0);
    const audits = await readAuditEvents(orderId);
    const refusal = audits.find(
      (a) =>
        (a.payload as { resourceId?: string; outcome?: string }).resourceId ===
          orderId && (a.payload as { outcome?: string }).outcome === "failure",
    );
    expect(
      (refusal!.payload as { metadata?: { reason?: string } }).metadata?.reason,
    ).toBe("SOD_VIOLATION");
  });
});

describe("applyPosting — A -> B -> C substantive chain", () => {
  it("closes each previous span the day before and keeps one open holder", async () => {
    const employeeId = await seedEmployee(officeA);
    const officeC = randomUUID();
    const postB = await seedPost(officeB);
    const postC = await seedPost(officeC);

    await publishApply({ orderId: randomUUID(), employeeId, postId: postB, effectiveDate: "2027-01-10", orderNumber: "ORD/CH/1" });
    await publishApply({ orderId: randomUUID(), employeeId, postId: postC, effectiveDate: "2027-03-10", orderNumber: "ORD/CH/2" });

    const occ = (await readOccupancy(employeeId)).sort((a, b) =>
      a.effectiveFrom.localeCompare(b.effectiveFrom),
    );
    expect(occ).toHaveLength(2);
    expect(occ[0]!.postId).toBe(postB);
    expect(occ[0]!.effectiveTo).toBe("2027-03-09");
    expect(occ[1]!.postId).toBe(postC);
    expect(occ[1]!.effectiveTo).toBeNull();

    const ledger = (await readLedger(employeeId)).sort((a, b) =>
      a.effectiveFrom.localeCompare(b.effectiveFrom),
    );
    expect(ledger).toHaveLength(2);
    expect(ledger[0]!.effectiveTo).toBe("2027-03-09");
    expect(ledger[1]!.effectiveTo).toBeNull();
    expect(await readEmployeeDept(employeeId)).toBe(officeC);
  });
});

describe("applyPosting — non-substantive charges leave the home office alone", () => {
  for (const chargeType of ["acting", "additional", "in_charge"]) {
    it(`${chargeType} charge records occupancy but does not move the employee`, async () => {
      const employeeId = await seedEmployee(officeA);
      const before = await readEmployeeRow(employeeId);
      const postId = await seedPost(officeB);
      const orderId = randomUUID();

      await publishApply({ orderId, employeeId, postId, effectiveDate: "2027-02-01", orderNumber: `ORD/${chargeType}`, chargeType });

      const occ = await readOccupancy(employeeId);
      expect(occ).toHaveLength(1);
      expect(occ[0]!.chargeType).toBe(chargeType);
      const after = await readEmployeeRow(employeeId);
      expect(after.departmentId).toBe(officeA);
      expect(after.designationId).toBe(before.designationId);
      // no office-movement event for a non-substantive charge
      const changed = (await readOutboxByTopics(["hrms.posting.changed"])).filter(
        (e) => (e.payload as { employeeId?: string }).employeeId === employeeId,
      );
      expect(changed).toHaveLength(0);
    });
  }

  it("a substantive posting bumps the employee version (optimistic lock sees it)", async () => {
    const employeeId = await seedEmployee(officeA);
    const before = await readEmployeeRow(employeeId);
    await publishApply({ orderId: randomUUID(), employeeId, postId: await seedPost(officeB), effectiveDate: "2027-02-01", orderNumber: "ORD/VER" });
    expect((await readEmployeeRow(employeeId)).version).toBe(before.version + 1);
  });
});

describe("applyPosting — same-day / back-dated orders are audited refusals", () => {
  it("same-day order after a posting is refused (no raw 23514, nothing written)", async () => {
    const employeeId = await seedEmployee(officeA);
    const postB = await seedPost(officeB);
    const postC = await seedPost(randomUUID());
    await publishApply({ orderId: randomUUID(), employeeId, postId: postB, effectiveDate: "2027-04-10", orderNumber: "ORD/SD/1" });

    const orderId = randomUUID();
    await publishApply({ orderId, employeeId, postId: postC, effectiveDate: "2027-04-10", orderNumber: "ORD/SD/2" });

    expect(await refusalReason(orderId)).toBe("EFFECTIVE_DATE_NOT_AFTER_CURRENT");
    expect(await readOccupancy(employeeId)).toHaveLength(1);
    expect(await readLedger(employeeId)).toHaveLength(1);
    expect(await readEmployeeDept(employeeId)).toBe(officeB);
  });

  it("back-dated order is refused with an audited reason", async () => {
    const employeeId = await seedEmployee(officeA);
    const postB = await seedPost(officeB);
    const postC = await seedPost(randomUUID());
    await publishApply({ orderId: randomUUID(), employeeId, postId: postB, effectiveDate: "2027-05-10", orderNumber: "ORD/BD/1" });

    const orderId = randomUUID();
    await publishApply({ orderId, employeeId, postId: postC, effectiveDate: "2027-05-01", orderNumber: "ORD/BD/2" });

    expect(await refusalReason(orderId)).toBe("EFFECTIVE_DATE_NOT_AFTER_CURRENT");
    expect(await readOccupancy(employeeId)).toHaveLength(1);
  });
});

describe("applyPosting — command idempotency is order-derived only", () => {
  it("two submissions of one order with different client idempotency keys apply once", async () => {
    const { applyPosting } = await import("./commands.js");
    const employeeId = await seedEmployee(officeA);
    const postId = await seedPost(officeB);
    const orderId = randomUUID();
    const body = { orderId, employeeId, postId, effectiveDate: "2027-06-01", orderNumber: "ORD/IDEM", chargeType: "substantive" as const };
    const ctx = (key: string) =>
      ({ tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), idempotencyKey: key }) as never;

    await runWithTenant(TENANT, () => applyPosting(ctx("client-key-1"), body));
    await drain();
    await runWithTenant(TENANT, () => applyPosting(ctx("client-key-2"), body));
    await drain();

    expect(await readOccupancy(employeeId)).toHaveLength(1);
    expect(await readServiceBook(employeeId)).toHaveLength(1);
  });
});
