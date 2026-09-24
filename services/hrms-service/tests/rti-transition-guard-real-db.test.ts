/**
 * RTI f3-consumer silent-no-op regression (real DB, no mocks).
 *
 * BUG: f3-consumer.ts's rti_routes__1..rti_routes__4 cases called
 * repo.transitionRtiTx(tx, ...) -- which returns `null`, not a thrown error,
 * when its guarded UPDATE's WHERE clause (status IN opts.from) matches zero
 * rows: not found, or (the race this module's routes.ts pre-check SELECT is
 * inherently vulnerable to -- see the same TOCTOU shape fixed for medical
 * claims approval in this same PR) a concurrent transition already moved the
 * row out of the expected state between routes.ts's own read and this write.
 * The consumer discarded that return value and fell straight through to
 * `break`, with markProcessed() already committed -- the message was
 * permanently recorded as successfully processed, with NO thrown error, NO
 * retry, and NO DLQ entry. A lost race silently vanished with zero
 * operational trace, instead of surfacing so the caller/ops can act on it.
 *
 * This test publishes rti_routes__2 ("respond") against a request that is
 * ALREADY in status "responded" (simulating the losing side of exactly that
 * race) and proves the fixed consumer now (a) throws instead of silently
 * succeeding, (b) the message ends up in the DLQ (real operational
 * visibility -- MemoryQueue's own retry-then-DLQ policy takes over from
 * there, same mechanism basicminor-concurrency.test.ts and
 * rti-nested-tx-deadlock.test.ts already rely on for this queue), and
 * (c) the row's data is untouched by the rejected write (no partial/silent
 * corruption either).
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerF3_rti_Consumers } from "../src/modules/rti/f3-consumer.js";
import { hrmsRtiRequests } from "../src/modules/rti/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "f1111111-dead-4000-8000-00000000c0de";
const ACTOR = "f1111111-dead-4000-8000-0000000ac70a";

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

function makeMsg(payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type: COMMANDS.f3RouteWrite, tenantId: TENANT, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0", payload,
  };
}

async function seedRti(status: string, responseText: string | null, respondedDate: string | null): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsRtiRequests).values({
    id, tenantId: TENANT, referenceNo: `RTI-GUARD-${id.slice(0, 8)}`,
    applicantName: "Test Applicant", subject: "Test subject", requestText: "Test request text",
    receivedDate: "2027-01-01", dueDate: "2027-01-31", status,
    responseText, respondedDate,
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  return id;
}

describe("rti f3-consumer -- guarded-transition failure is no longer a silent no-op (real DB, no mocks)", () => {
  it("rti_routes__2 (respond) against an ALREADY-'responded' row: throws, lands in the DLQ, and does not overwrite the existing response", async () => {
    const ORIGINAL_RESPONSE = "Original PIO response — must survive untouched";
    const id = await seedRti("responded", ORIGINAL_RESPONSE, "2027-01-15");

    const q = tenantWrappedQueue();
    registerF3_rti_Consumers(q);
    await q.start();

    // Simulates the loser of a "respond" race: this command's `from` guard
    // (filed/assigned) can never match a row that's already 'responded'.
    await q.publish(COMMANDS.f3RouteWrite, makeMsg({
      op: "rti_routes__2", tenantId: TENANT, id, params: { id },
      body: { responseText: "A SECOND, conflicting response that lost the race", respondedDate: "2027-01-20" },
    }));

    const DRAIN_TIMEOUT_MS = 10_000;
    let timedOut = false;
    await Promise.race([
      q.drain(),
      new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
    ]);
    expect(timedOut, "queue did not drain -- unexpected hang").toBe(false);

    // THE FIX: the lost-race write is now visible in the DLQ instead of
    // vanishing with zero trace.
    expect(q.dlq.length, `expected the guard-rejected message in the DLQ, got: ${JSON.stringify(q.dlq)}`).toBeGreaterThan(0);
    const dlqEntry = q.dlq.find((d) => {
      const payload = d.msg.payload as { id?: string };
      return payload.id === id;
    });
    expect(dlqEntry).toBeDefined();
    expect(dlqEntry?.error).toMatch(/rti_routes__2|guarded transition|no row/i);

    // THE ROW ITSELF: untouched by the rejected write -- still the original
    // response, not silently overwritten and not corrupted.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await withTenantScope(db, TENANT, (tx: any) =>
      tx.select().from(hrmsRtiRequests).where(eq(hrmsRtiRequests.id, id)));
    expect(rows[0]?.status).toBe("responded");
    expect(rows[0]?.responseText).toBe(ORIGINAL_RESPONSE);
    expect(rows[0]?.respondedDate).toBe("2027-01-15");
    expect(rows[0]?.version).toBe(1); // never bumped -- the guarded UPDATE never matched

    await q.stop();
  }, { timeout: 20_000 });

  it("sanity: a VALID rti_routes__2 transition (filed -> responded) still succeeds normally", async () => {
    const id = await seedRti("filed", null, null);
    const q = tenantWrappedQueue();
    registerF3_rti_Consumers(q);
    await q.start();

    await q.publish(COMMANDS.f3RouteWrite, makeMsg({
      op: "rti_routes__2", tenantId: TENANT, id, params: { id },
      body: { responseText: "The real response", respondedDate: "2027-01-20" },
    }));
    await q.drain();

    expect(q.dlq.filter((d) => (d.msg.payload as { id?: string }).id === id)).toHaveLength(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await withTenantScope(db, TENANT, (tx: any) =>
      tx.select().from(hrmsRtiRequests).where(eq(hrmsRtiRequests.id, id)));
    expect(rows[0]?.status).toBe("responded");
    expect(rows[0]?.responseText).toBe("The real response");
    expect(rows[0]?.version).toBe(2);

    await q.stop();
  });
});
