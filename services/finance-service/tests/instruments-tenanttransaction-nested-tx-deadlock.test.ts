/**
 * Regression test for the Section-1 nested-transaction connection-pool
 * deadlock, tenantTransaction/db.transaction variant (see
 * .claude/skills/16-production-readiness-audit.md): repo.insertInstrument
 * and repo.transition each opened their OWN db.transaction() internally,
 * called from inside the instruments consumer handlers own already-open
 * outer db.transaction(). With pool.max concurrent outer transactions in
 * flight, every one of them needs an extra (nested) pool connection at
 * the same moment none is free, deadlocking silently forever.
 *
 * Found during the tenantTransaction re-audit (services fixed earlier in
 * the session were only scanned for the scopedRead name pattern, missing
 * plain db.transaction()-based helpers like these two).
 *
 * Fixed by adding insertInstrumentTx/transitionTx siblings that take the
 * already-open tx directly, and routing the consumer handlers (which
 * already run inside db.transaction) onto those instead.
 *
 * This test exercises both sites at pool.max + 3 concurrency, real
 * Postgres, real pool. MemoryQueue.deliver() never rejects -- a handler
 * error is captured into q.dlq instead of throwing -- so a bare drain()
 * check alone would also pass if every delivery silently failed before
 * ever reaching the nested-transaction call. Both assertions below (empty
 * dlq, and the expected row count actually landed) are required to prove
 * the fix path genuinely ran, not just that nothing hung.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerInstrumentsConsumers } from "../src/modules/instruments/consumer.js";
import { financeInstruments } from "../src/modules/treasury/schema.js";

const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "bb000001-ec00-4000-8000-0000000000ff";
const CONCURRENCY = 13;

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

async function drainOrTimeout(q: MemoryQueue, timeoutMs = 10_000): Promise<boolean> {
  let timedOut = false;
  await Promise.race([
    q.drain(),
    new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, timeoutMs)),
  ]);
  return timedOut;
}

describe("instruments consumer -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent finance.instrument.issue commands drain without deadlocking the connection pool`,
    async () => {
      const q = tenantWrappedQueue();
      registerInstrumentsConsumers(q);
      await q.start();

      const nos = Array.from({ length: CONCURRENCY }, () => randomUUID());
      await Promise.all(nos.map((no) =>
        q.publish("finance.instrument.issue", makeMsg("finance.instrument.issue", {
          tenantId: TENANT,
          instrumentType: "cheque",
          instrumentNo: no,
          bankName: "Test Bank",
          payee: "Test Payee",
          amountMinor: 10000,
        })),
      ));

      const timedOut = await drainOrTimeout(q);
      expect(timedOut, "queue did not drain within 10000ms -- nested-transaction pool deadlock regressed").toBe(false);
      expect(q.dlq, `handler(s) failed unexpectedly: ${JSON.stringify(q.dlq)}`).toEqual([]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await withTenantScope(db, TENANT, (tx: any) =>
        tx.select({ instrumentNo: financeInstruments.instrumentNo }).from(financeInstruments)
          .where(inArray(financeInstruments.instrumentNo, nos)),
      );
      expect(rows.length, "insertInstrumentTx did not actually create the expected rows").toBe(CONCURRENCY);

      await q.stop();
    },
    { timeout: 20_000 },
  );

  it(
    `${CONCURRENCY} concurrent finance.instrument.transition commands drain without deadlocking the connection pool`,
    async () => {
      const ids: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        const id = randomUUID();
        ids.push(id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await withTenantScope(db, TENANT, (tx: any) =>
          tx.insert(financeInstruments).values({
            id, tenantId: TENANT, instrumentType: "cheque", instrumentNo: randomUUID(),
            bankName: "Test Bank", payee: "Test Payee", amountMinor: BigInt(10000),
            issueDate: "2026-09-01", status: "issued",
            createdBy: ACTOR, updatedBy: ACTOR,
          }),
        );
      }

      const q = tenantWrappedQueue();
      registerInstrumentsConsumers(q);
      await q.start();

      await Promise.all(ids.map((id) =>
        q.publish("finance.instrument.transition", makeMsg("finance.instrument.transition", {
          tenantId: TENANT, id, action: "present",
        })),
      ));

      const timedOut = await drainOrTimeout(q);
      expect(timedOut, "queue did not drain within 10000ms -- nested-transaction pool deadlock regressed").toBe(false);
      expect(q.dlq, `handler(s) failed unexpectedly: ${JSON.stringify(q.dlq)}`).toEqual([]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await withTenantScope(db, TENANT, (tx: any) =>
        tx.select({ status: financeInstruments.status }).from(financeInstruments)
          .where(inArray(financeInstruments.id, ids)),
      );
      expect(rows.length).toBe(CONCURRENCY);
      expect(rows.every((r: { status: string }) => r.status === "presented"), "transitionTx did not actually apply the expected status change").toBe(true);

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
