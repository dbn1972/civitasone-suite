/**
 * Regression test for the Section-1 nested-transaction connection-pool
 * deadlock (see .claude/skills/16-production-readiness-audit.md): a repo
 * function built on scopedRead() — which opens its OWN db.transaction() —
 * called from inside a consumer's already-open outer db.transaction(). With
 * pool.max concurrent outer transactions in flight, every one of them needs
 * an extra ("nested") pool connection at the same moment none is free,
 * deadlocking silently forever.
 *
 * Found (pre-fix) in four finance-service consumers, all reading a
 * scopedRead-based repo function from inside their own db.transaction():
 *   - bank-recon: finance.bank_statement.reconcile (findStatement,
 *     unreconciledPayments, unreconciledChallans — 3 nested reads per call,
 *     the worst of the four)
 *   - period-close: finance.period.close / finance.period.reopen
 *     (findPeriodClose)
 *   - pfms: finance.pfms.batch_sign / finance.pfms.batch_submit
 *     (findPfmsById)
 *   - recon: finance.recon.exception_action (getBreak)
 *
 * This test exercises the worst offender (bank-recon, 3 nested reads/call) at
 * pool.max + 3 concurrency, real Postgres, real pool — proving the
 * *Tx-suffixed replacements (findStatementTx / unreconciledPaymentsTx /
 * unreconciledChallansTx) actually avoid the deadlock, not just that the
 * command "completes" under mocks. Confirmed empirically before this fix
 * (not merely reasoned about): the identical harness against the pre-fix
 * code (repo.findStatement/unreconciledPayments/unreconciledChallans called
 * straight from inside the consumer's db.transaction) reliably failed to
 * drain within 15s; against the fix it drains in well under 1s.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerBankReconConsumers } from "../src/modules/bank-recon/consumer.js";
import { bankStatement } from "../src/modules/bank-recon/schema.js";

const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "bb000001-ec00-4000-8000-0000000000ff";
// pool.max defaults to 10 (packages/db/src/pool.ts, DB_POOL_MAX) when not
// routed through pgbouncer, which is exactly the test DB's connection style
// (vitest.config.ts DATABASE_URL points straight at Postgres). +3 to clear it.
const CONCURRENCY = 13;

/** Mirrors worker.ts's global subscribe wrap: every handler runs under the
 *  message's tenant GUC so FORCE RLS reads/writes succeed, exactly like production. */
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

describe("bank-recon consumer — nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent finance.bank_statement.reconcile commands drain without deadlocking the connection pool`,
    async () => {
      const ids: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        const id = randomUUID();
        ids.push(id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await withTenantScope(db, TENANT, (tx: any) =>
          tx.insert(bankStatement).values({
            id, tenantId: TENANT, bankAccountId: randomUUID(),
            status: "imported", createdBy: ACTOR,
          }),
        );
      }

      const q = tenantWrappedQueue();
      registerBankReconConsumers(q);
      await q.start();

      await Promise.all(ids.map((id) =>
        q.publish("finance.bank_statement.reconcile", makeMsg("finance.bank_statement.reconcile", { id, tenantId: TENANT })),
      ));

      // The bug's failure mode is `queue.drain()` never resolving (every
      // in-flight transaction blocked on an unavailable connection forever),
      // so the proof this test needs is that drain() resolves at all within a
      // generous-but-bounded window — not a precise latency assertion. A
      // regression here should fail LOUD (timeout) rather than hang the
      // whole suite indefinitely.
      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms — nested-transaction pool deadlock regressed`).toBe(false);

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
