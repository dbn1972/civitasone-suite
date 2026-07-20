/**
 * estab-service — records management (CSMOP / Record Retention Schedule) suite.
 *
 * 1. Assign category B → retention_years = 10, review_due_date ≈ now + 10y.
 * 2. Assign category A → retention_years NULL, review_due_date NULL (permanent).
 * 3. Weed-out lifecycle: propose → approve (different actor) → destroy with cert.
 * 4. Maker≠checker: approve by the proposer → MAKER_CHECKER_VIOLATION (DLQ), status unchanged.
 * 5. assertWeedable pure guard: Category A throws; before review-due throws; on/after passes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { estabFileRecord, estabWeedout } from "../src/modules/records/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerRecordsConsumers } from "../src/modules/records/consumer.js";
import { COMMANDS } from "../src/modules/records/commands.js";
import { assertWeedable, computeReviewDueDate, DomainError } from "../src/modules/records/domain.js";

/**
 * Test-harness fix: `new MemoryQueue()` used directly here (not the
 * `createQueue()` factory) does NOT auto-wrap subscribed handlers with
 * `withTenantConsumer`. Production wiring (queue-service's `createQueue()`)
 * decorates `subscribe()` so every consumer handler runs inside
 * `runWithTenant(msg.tenantId, ...)`, which is what lets `db.transaction()`
 * pick up the tenant GUC. Without this wrapping, consumer writes/reads in
 * these tests run with no RLS GUC set. Mirror that decoration here.
 */
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

const TENANT  = randomUUID();
const ACTOR   = "00000000-aaaa-4000-8000-000000000001";
const PROPOSER = "00000000-aaaa-4000-8000-0000000000a1";
const CHECKER  = "00000000-aaaa-4000-8000-0000000000b2";

const FILE_B  = "10000000-bbbb-4000-8000-000000000001";
const FILE_A  = "10000000-bbbb-4000-8000-000000000002";
const FILE_W  = "10000000-bbbb-4000-8000-000000000003";
const FILE_MC = "10000000-bbbb-4000-8000-000000000004";

const WEEDOUT_1 = "20000000-cccc-4000-8000-000000000001";
const WEEDOUT_2 = "20000000-cccc-4000-8000-000000000002";

const MSG_ASSIGN_B  = "30000000-dddd-4000-8000-000000000001";
const MSG_ASSIGN_A  = "30000000-dddd-4000-8000-000000000002";
const MSG_PROPOSE_1 = "30000000-dddd-4000-8000-000000000003";
const MSG_APPROVE_1 = "30000000-dddd-4000-8000-000000000004";
const MSG_DESTROY_1 = "30000000-dddd-4000-8000-000000000005";
const MSG_PROPOSE_2 = "30000000-dddd-4000-8000-000000000006";
const MSG_APPROVE_2 = "30000000-dddd-4000-8000-000000000007";

const ALL_MSG_IDS = [
  MSG_ASSIGN_B, MSG_ASSIGN_A, MSG_PROPOSE_1, MSG_APPROVE_1, MSG_DESTROY_1, MSG_PROPOSE_2, MSG_APPROVE_2,
];

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Test-harness fix: bare db.delete() outside db.transaction() runs with no RLS
// GUC set — wrap in runWithTenant(TENANT, () => db.transaction(...)).
async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      await tx.delete(estabWeedout).where(eq(estabWeedout.tenantId, TENANT));
      await tx.delete(estabFileRecord).where(eq(estabFileRecord.tenantId, TENANT));
      for (const id of ALL_MSG_IDS) {
        await tx.delete(processed).where(eq(processed.messageId, id));
      }
    }),
  );
}

function envelope(messageId: string, type: string, actorId: string, payload: unknown) {
  return {
    messageId, type,
    tenantId: TENANT, actorId, correlationId: `corr-${messageId.slice(0, 8)}`, schemaVersion: "1.0",
    payload,
  };
}

beforeAll(async () => { await wipe(); });
afterAll(async () => {
  await wipe();
  await sqlClient.end();
});

// ── 1. Assign category B ─────────────────────────────────────────────────────

describe("Record category — retention derivation", () => {
  it("assigning category B yields retention_years=10 and review_due_date ≈ now + 10y", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerRecordsConsumers(q);
    await q.start();

    const before = new Date();
    await q.publish(COMMANDS.assignCategory, envelope(MSG_ASSIGN_B, COMMANDS.assignCategory, ACTOR, {
      fileId: FILE_B, tenantId: TENANT, category: "B",
    }));
    await delay(500);
    await q.stop();

    const rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(estabFileRecord).where(eq(estabFileRecord.fileId, FILE_B))),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.recordCategory).toBe("B");
    expect(rows[0]?.retentionYears).toBe(10);
    expect(rows[0]?.reviewDueDate).not.toBeNull();

    const due = new Date(rows[0]!.reviewDueDate as string);
    const yearsOut = (due.getTime() - before.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    expect(yearsOut).toBeGreaterThan(9.9);
    expect(yearsOut).toBeLessThan(10.1);
  });

  it("assigning category A is permanent: retention_years and review_due_date are NULL", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerRecordsConsumers(q);
    await q.start();

    await q.publish(COMMANDS.assignCategory, envelope(MSG_ASSIGN_A, COMMANDS.assignCategory, ACTOR, {
      fileId: FILE_A, tenantId: TENANT, category: "A",
    }));
    await delay(500);
    await q.stop();

    const rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(estabFileRecord).where(eq(estabFileRecord.fileId, FILE_A))),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.recordCategory).toBe("A");
    expect(rows[0]?.retentionYears).toBeNull();
    expect(rows[0]?.reviewDueDate).toBeNull();
  });
});

// ── 3. Weed-out lifecycle ────────────────────────────────────────────────────

describe("Weed-out workflow — propose → approve → destroy", () => {
  it("transitions proposed → approved (by a different actor) → destroyed with a cert", async () => {
    // Seed a record already past its review-due date so it is weedable.
    await runWithTenant(TENANT, () =>
      db.transaction((tx) =>
        tx.insert(estabFileRecord).values({
          tenantId: TENANT, fileId: FILE_W, recordCategory: "E", retentionYears: 1,
          reviewDueDate: "2000-01-01", createdBy: ACTOR,
        }),
      ),
    );

    const q = wireTenantAwareQueue(new MemoryQueue());
    registerRecordsConsumers(q);
    await q.start();

    await q.publish(COMMANDS.weedoutPropose, envelope(MSG_PROPOSE_1, COMMANDS.weedoutPropose, PROPOSER, {
      id: WEEDOUT_1, fileId: FILE_W, tenantId: TENANT, reason: "retention elapsed",
    }));
    await delay(400);
    let rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(estabWeedout).where(eq(estabWeedout.id, WEEDOUT_1))),
    );
    expect(rows[0]?.status).toBe("proposed");
    expect(rows[0]?.proposedBy).toBe(PROPOSER);

    await q.publish(COMMANDS.weedoutApprove, envelope(MSG_APPROVE_1, COMMANDS.weedoutApprove, CHECKER, {
      id: WEEDOUT_1, tenantId: TENANT,
    }));
    await delay(400);
    rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(estabWeedout).where(eq(estabWeedout.id, WEEDOUT_1))),
    );
    expect(rows[0]?.status).toBe("approved");
    expect(rows[0]?.reviewedBy).toBe(CHECKER);

    await q.publish(COMMANDS.weedoutDestroy, envelope(MSG_DESTROY_1, COMMANDS.weedoutDestroy, CHECKER, {
      id: WEEDOUT_1, tenantId: TENANT, destructionCertRef: "CERT/2030/001",
    }));
    await delay(400);
    await q.stop();

    rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(estabWeedout).where(eq(estabWeedout.id, WEEDOUT_1))),
    );
    expect(rows[0]?.status).toBe("destroyed");
    expect(rows[0]?.destructionCertRef).toBe("CERT/2030/001");
    expect(rows[0]?.destroyedAt).not.toBeNull();

    expect(q.dlq).toHaveLength(0);
  });
});

// ── 4. Maker ≠ checker ───────────────────────────────────────────────────────

describe("Weed-out workflow — maker ≠ checker", () => {
  it("approval by the proposer is rejected with MAKER_CHECKER_VIOLATION and status stays 'proposed'", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue({ maxAttempts: 1 }));
    registerRecordsConsumers(q);
    await q.start();

    await q.publish(COMMANDS.weedoutPropose, envelope(MSG_PROPOSE_2, COMMANDS.weedoutPropose, PROPOSER, {
      id: WEEDOUT_2, fileId: FILE_MC, tenantId: TENANT, reason: "self-approval attempt",
    }));
    await delay(400);

    // Same actor approves → maker≠checker violation → routed to DLQ.
    await q.publish(COMMANDS.weedoutApprove, envelope(MSG_APPROVE_2, COMMANDS.weedoutApprove, PROPOSER, {
      id: WEEDOUT_2, tenantId: TENANT,
    }));
    await delay(500);
    await q.stop();

    const rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(estabWeedout).where(eq(estabWeedout.id, WEEDOUT_2))),
    );
    expect(rows[0]?.status).toBe("proposed");
    expect(rows[0]?.reviewedBy).toBeNull();

    expect(q.dlq.length).toBeGreaterThanOrEqual(1);
    expect(q.dlq[0]?.error).toMatch(/MAKER_CHECKER/);
  });
});

// ── 5. assertWeedable — pure guard ───────────────────────────────────────────

describe("assertWeedable — pure guard", () => {
  it("Category A (permanent) can never be weeded out", () => {
    const past = new Date("2000-01-01T00:00:00.000Z");
    expect(() => assertWeedable("A", null, new Date())).toThrow(DomainError);
    expect(() => assertWeedable("A", past, new Date())).toThrow(/permanent/i);
  });

  it("throws when now is before the review-due date", () => {
    const future = computeReviewDueDate("B", new Date());
    expect(future).not.toBeNull();
    expect(() => assertWeedable("B", future, new Date())).toThrow(/before the review-due date/i);
  });

  it("passes on/after the review-due date", () => {
    const due = new Date("2000-01-01T00:00:00.000Z");
    expect(() => assertWeedable("E", due, new Date())).not.toThrow();
  });
});
