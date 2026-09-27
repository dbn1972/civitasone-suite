/**
 * Indent-budget enforcement (real DB, no mocks).
 *
 * CRITICAL FIX: po/consumer.ts's poCreate (and gemOrderCreate) handler
 * previously never looked up the indent a PO/GeM-order referenced at all —
 * indentRef was stored as a completely unvalidated opaque string, with no
 * check against the indent's approved total_minor and no tracking of how
 * much of an indent had already been consumed by prior POs. Confirmed live:
 * a Rs 900 PO succeeded against a Rs 500 *approved* indent, and two
 * simultaneous PO-creation requests against one fresh Rs 900 indent BOTH
 * succeeded — Rs 1,800 committed against a Rs 900 ceiling.
 *
 * This suite reproduces both bugs (a single PO exceeding the indent's
 * approved amount, and the concurrent double-spend) against the fixed
 * poCreate/gemOrderCreate handlers and indent/repo.ts's
 * addIndentCommittedGuarded, and proves the fix with genuinely concurrent
 * DB transactions — not sequential calls: MemoryQueue.publish() (bus.ts)
 * is fire-and-forget (it schedules delivery via setTimeout(0) and returns
 * before any handler runs), so Promise.all([q.publish(...), q.publish(...)])
 * lets both poCreate handler invocations' db.transaction() calls genuinely
 * overlap on separate pooled connections — the concurrency-test scenario
 * the task asked to close needs exactly that overlap; a queue that
 * serialised handler execution would prove nothing about the underlying
 * Postgres-level race.
 *
 * Race-safety itself comes from indent/repo.ts's addIndentCommittedGuarded —
 * a single atomic `UPDATE ... WHERE total_minor - committed_minor >= delta
 * RETURNING id`, mirroring finance-service's addCommittedGuarded
 * (budget/allocation-repo.ts) exactly. See that function's doc comment for
 * why Postgres's own row-level locking on the UPDATE statement closes the
 * race with no separate SELECT ... FOR UPDATE step.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import type { Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementIndents, type IndentInsert } from "../src/modules/indent/schema.js";
import { procurementPos, procurementPoItems } from "../src/modules/po/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerPoConsumers } from "../src/modules/po/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const ACTOR  = "a0000000-0000-4000-8000-000000000001";
const TENANT = "b0000000-d001-4000-8000-000000000001";

/** Same helper as procurement.test.ts's wireTenantAwareQueue, typed to return
 *  the concrete MemoryQueue (not the Queue interface) so callers can still
 *  reach .drain()/.dlq, which are MemoryQueue-only test aids, not part of
 *  the production Queue interface. */
function wireTenantAwareQueue(q: MemoryQueue): MemoryQueue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(procurementPoItems).where(eq(procurementPoItems.tenantId, TENANT));
    await tx.delete(procurementPos).where(eq(procurementPos.tenantId, TENANT));
    await tx.delete(procurementIndents).where(eq(procurementIndents.tenantId, TENANT));
  }));
}

async function seedIndent(row: {
  id: string; indentNo: string; totalMinor: bigint; status?: string; committedMinor?: bigint;
}): Promise<void> {
  const insert: IndentInsert = {
    id: row.id, tenantId: TENANT, indentNo: row.indentNo,
    department: "Admin", purpose: "indent-budget-enforcement test",
    totalMinor: row.totalMinor, committedMinor: row.committedMinor ?? 0n,
    currency: "INR", status: row.status ?? "approved",
    createdBy: ACTOR, updatedBy: ACTOR,
  };
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(procurementIndents).values(insert)));
}

async function getIndent(id: string) {
  const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select().from(procurementIndents).where(eq(procurementIndents.id, id))));
  return rows[0] ?? null;
}

async function outboxFor(poId: string) {
  const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
  return rows.filter((r) => (r.payload as { poId?: string })?.poId === poId);
}

function poCreateMessage(opts: { poId: string; indentId: string; rupees: number; vendorId?: string }) {
  return {
    messageId: opts.poId,
    type: COMMANDS.poCreate,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: `corr-${opts.poId}`,
    schemaVersion: "1.0",
    payload: {
      id: opts.poId, tenantId: TENANT, poNo: `PO-IB-${opts.poId.slice(0, 8)}`,
      vendorId: opts.vendorId ?? randomUUID(),
      indentRef: `procurement_indent:${opts.indentId}`,
      items: [{ itemCode: "ITM-1", description: "Test item", quantity: 1, unit: "nos", unitPriceMinor: opts.rupees * 100 }],
    },
  };
}

function gemOrderMessage(opts: { poId: string; indentId: string; rupees: number; vendorId?: string }) {
  return {
    messageId: opts.poId,
    type: COMMANDS.gemOrderCreate,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: `corr-${opts.poId}`,
    schemaVersion: "1.0",
    payload: {
      id: opts.poId, tenantId: TENANT, poNo: `GEM-IB-${opts.poId.slice(0, 8)}`,
      vendorId: opts.vendorId ?? randomUUID(), gemOrderNo: `GEM-ORD-${opts.poId.slice(0, 8)}`,
      indentRef: `procurement_indent:${opts.indentId}`,
      items: [{ itemCode: "ITM-1", description: "Test item", quantity: 1, unit: "nos", unitPriceMinor: opts.rupees * 100 }],
    },
  };
}

async function drain(q: MemoryQueue): Promise<void> {
  const DRAIN_TIMEOUT_MS = 15_000;
  let timedOut = false;
  await Promise.race([
    q.drain(),
    new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
  ]);
  expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms`).toBe(false);
}

describe("indent-budget enforcement — poCreate / gemOrderCreate (real DB, no mocks)", () => {
  beforeAll(wipe);
  afterAll(async () => { await wipe(); await sqlClient.end(); });

  it("PO within the indent's remaining budget succeeds and reserves the indent's committed_minor", async () => {
    const indentId = randomUUID();
    await seedIndent({ id: indentId, indentNo: "IND-IB-001", totalMinor: 100000n }); // Rs 1,000 approved

    const q = wireTenantAwareQueue(new MemoryQueue());
    registerPoConsumers(q);
    await q.start();

    const poId = randomUUID();
    await q.publish(COMMANDS.poCreate, poCreateMessage({ poId, indentId, rupees: 400 })); // well within budget
    await drain(q);
    await q.stop();

    const [po] = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementPos).where(eq(procurementPos.id, poId))));
    expect(po, "PO within budget should have been written").toBeTruthy();
    expect(po?.status).toBe("draft");

    const indent = await getIndent(indentId);
    expect(indent?.committedMinor).toBe(40000n);
  });

  it("PO exceeding the indent's remaining approved amount is rejected with a clear error and no PO is written (Rs 900 PO vs Rs 500 approved indent)", async () => {
    const indentId = randomUUID();
    await seedIndent({ id: indentId, indentNo: "IND-IB-002", totalMinor: 50000n }); // Rs 500 approved — the exact bug repro

    const q = wireTenantAwareQueue(new MemoryQueue());
    registerPoConsumers(q);
    await q.start();

    const poId = randomUUID();
    await q.publish(COMMANDS.poCreate, poCreateMessage({ poId, indentId, rupees: 900 })); // 80% over budget
    await drain(q);
    await q.stop();

    const [po] = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementPos).where(eq(procurementPos.id, poId))));
    expect(po, "over-budget PO must NOT have been written — this is the exact reported bug").toBeFalsy();

    const indent = await getIndent(indentId);
    expect(indent?.committedMinor).toBe(0n); // nothing reserved

    const events = await outboxFor(poId);
    const rejection = events.find((e) => e.eventType === EVENTS.poBudgetExceeded);
    expect(rejection, "expected a procurement.po.budget_exceeded event").toBeTruthy();
    const payload = rejection?.payload as { code?: string; reason?: string };
    expect(payload?.code).toBe("INDENT_BUDGET_EXCEEDED");
    expect(payload?.reason).toMatch(/exceeds indent .* remaining approved amount/);
  });

  it(
    "CONCURRENCY: two simultaneous PO-creation requests against one fresh indent — combined amount exceeds it — only one succeeds, the other is rejected, total committed never exceeds the indent (Rs 900 + Rs 900 vs Rs 900 indent)",
    async () => {
      const indentId = randomUUID();
      await seedIndent({ id: indentId, indentNo: "IND-IB-003", totalMinor: 90000n }); // Rs 900 approved — the exact bug repro

      const q = wireTenantAwareQueue(new MemoryQueue());
      registerPoConsumers(q);
      await q.start();

      const poIdA = randomUUID();
      const poIdB = randomUUID();

      // Genuine concurrency: both publish() calls return near-instantly
      // (fire-and-forget — see bus.ts's publish()), so both poCreate handler
      // invocations' db.transaction() calls are in flight at the same time,
      // on separate pooled connections, exactly reproducing the reported race.
      await Promise.all([
        q.publish(COMMANDS.poCreate, poCreateMessage({ poId: poIdA, indentId, rupees: 900 })),
        q.publish(COMMANDS.poCreate, poCreateMessage({ poId: poIdB, indentId, rupees: 900 })),
      ]);
      await drain(q);
      await q.stop();

      const pos = await runWithTenant(TENANT, () => db.transaction((tx) =>
        tx.select().from(procurementPos).where(eq(procurementPos.tenantId, TENANT))));
      const written = pos.filter((p) => p.id === poIdA || p.id === poIdB);
      expect(written.length, "exactly one of the two Rs 900 POs must have been written against the Rs 900 indent — the reported bug let BOTH through for Rs 1,800 total").toBe(1);

      const indent = await getIndent(indentId);
      expect(indent?.committedMinor, "committed_minor must equal exactly the one PO that fit, never both").toBe(90000n);
      expect(indent?.committedMinor).toBeLessThanOrEqual(indent!.totalMinor);

      const rejectedId = written[0]?.id === poIdA ? poIdB : poIdA;
      const rejectionEvents = await outboxFor(rejectedId);
      const rejection = rejectionEvents.find((e) => e.eventType === EVENTS.poBudgetExceeded);
      expect(rejection, "the PO that lost the race must have a budget_exceeded rejection event").toBeTruthy();
      expect((rejection?.payload as { code?: string })?.code).toBe("INDENT_BUDGET_EXCEEDED");
    },
    20_000,
  );

  it("PO against a non-approved (pending) indent is rejected with INDENT_NOT_APPROVED, no PO written", async () => {
    const indentId = randomUUID();
    await seedIndent({ id: indentId, indentNo: "IND-IB-004", totalMinor: 1000000n, status: "pending" });

    const q = wireTenantAwareQueue(new MemoryQueue());
    registerPoConsumers(q);
    await q.start();

    const poId = randomUUID();
    await q.publish(COMMANDS.poCreate, poCreateMessage({ poId, indentId, rupees: 100 })); // trivially within total_minor
    await drain(q);
    await q.stop();

    const [po] = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementPos).where(eq(procurementPos.id, poId))));
    expect(po, "a PO must never be created against an indent that is not yet approved").toBeFalsy();

    const events = await outboxFor(poId);
    const rejection = events.find((e) => e.eventType === EVENTS.poBudgetExceeded);
    expect((rejection?.payload as { code?: string })?.code).toBe("INDENT_NOT_APPROVED");
  });

  it("PO against a non-existent indentRef is rejected cleanly with INDENT_NOT_FOUND (not a thrown/retried error)", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerPoConsumers(q);
    await q.start();

    const poId = randomUUID();
    await q.publish(COMMANDS.poCreate, poCreateMessage({ poId, indentId: randomUUID(), rupees: 100 }));
    await drain(q);
    await q.stop();

    // No DLQ entry — a bad reference is a clean business rejection, not a retryable failure.
    expect(q.dlq.length, "a nonexistent indentRef must not land in the DLQ / trigger retries").toBe(0);

    const events = await outboxFor(poId);
    const rejection = events.find((e) => e.eventType === EVENTS.poBudgetExceeded);
    expect((rejection?.payload as { code?: string })?.code).toBe("INDENT_NOT_FOUND");
  });

  it("a malformed indentRef (no valid UUID) is rejected as INDENT_NOT_FOUND rather than throwing a Postgres cast error", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerPoConsumers(q);
    await q.start();

    const poId = randomUUID();
    await q.publish(COMMANDS.poCreate, {
      messageId: poId, type: COMMANDS.poCreate, tenantId: TENANT, actorId: ACTOR,
      correlationId: `corr-${poId}`, schemaVersion: "1.0",
      payload: {
        id: poId, tenantId: TENANT, poNo: "PO-IB-MALFORMED", vendorId: randomUUID(),
        indentRef: "not-a-real-reference",
        items: [{ itemCode: "ITM-1", description: "Test item", quantity: 1, unit: "nos", unitPriceMinor: 10000 }],
      },
    });
    await drain(q);
    await q.stop();

    expect(q.dlq.length, "a malformed indentRef must not throw an uncaught cast error / land in the DLQ").toBe(0);
    const events = await outboxFor(poId);
    expect((events.find((e) => e.eventType === EVENTS.poBudgetExceeded)?.payload as { code?: string })?.code).toBe("INDENT_NOT_FOUND");
  });

  it("gemOrderCreate is ALSO subject to indent-budget enforcement (same procurement_pos table, same bypass, now closed)", async () => {
    const indentId = randomUUID();
    await seedIndent({ id: indentId, indentNo: "IND-IB-005", totalMinor: 50000n }); // Rs 500 approved

    const q = wireTenantAwareQueue(new MemoryQueue());
    registerPoConsumers(q);
    await q.start();

    const poId = randomUUID();
    await q.publish(COMMANDS.gemOrderCreate, gemOrderMessage({ poId, indentId, rupees: 900 })); // over budget via GeM
    await drain(q);
    await q.stop();

    const [po] = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementPos).where(eq(procurementPos.id, poId))));
    expect(po, "a GeM award must be subject to the same indent-budget gate as poCreate").toBeFalsy();

    const indent = await getIndent(indentId);
    expect(indent?.committedMinor).toBe(0n);

    const events = await outboxFor(poId);
    expect((events.find((e) => e.eventType === EVENTS.poBudgetExceeded)?.payload as { code?: string })?.code).toBe("INDENT_BUDGET_EXCEEDED");
  });

  it("DB-level defense-in-depth: chk_indent_no_overcommit rejects committed_minor exceeding total_minor even via a direct raw UPDATE bypassing the app guard", async () => {
    const indentId = randomUUID();
    await seedIndent({ id: indentId, indentNo: "IND-IB-006", totalMinor: 1000n });

    // Deliberately skips addIndentCommittedGuarded's headroom check (unlike
    // it, this UPDATE has no `AND total_minor - committed_minor >= delta`
    // guard) to prove the CHECK constraint is a real, independent backstop —
    // not merely declared. Runs inside runWithTenant/db.transaction (not the
    // unscoped sqlClient) so the tenant GUC satisfies this table's FORCE RLS
    // policy and the UPDATE actually reaches the row instead of silently
    // matching zero rows.
    await expect(
      runWithTenant(TENANT, () => db.transaction((tx) =>
        (tx as unknown as { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }).execute(sql`
          UPDATE indent.procurement_indents SET committed_minor = 1001 WHERE id = ${indentId}::uuid
        `))),
    ).rejects.toThrow(/chk_indent_no_overcommit|constraint/i);

    const indent = await getIndent(indentId);
    expect(indent?.committedMinor, "the rejected UPDATE must not have partially applied").toBe(0n);
  });
});
