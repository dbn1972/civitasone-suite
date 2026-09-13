/**
 * TX-018 (finance-service slice) — GL org-structure validation
 * nested-transaction connection-pool deadlock regression.
 *
 * Found via the ENTERPRISE-GAP-REPORT-2026-09-07.md TX-018 sweep — the same
 * blind-spot class TX-011's nested-tx-guard.mjs was built to catch (and, on
 * its own first fleet-wide run, actually did catch this exact site):
 * gl/consumer.ts's postJournal() — called from all 5 GL posting handlers
 * (including the generic finance.gl.post handler this test exercises) while
 * inside their own already-open db.transaction() — called
 * org-structure/domain.ts's validateOrgAssignment() with NO tx param, which
 * unconditionally opens its OWN nested transaction (via
 * runWithTenant(...) => db.transaction(...)) for EACH of up to 4 org-ref
 * asserts it runs (assertLegalEntityExists, and — depending on which refs
 * the journal carries — assertCostCenterBelongsToLE /
 * assertProfitCenterBelongsToLE / assertOperatingUnitBelongsToLE). Under
 * pool.max concurrent in-flight GL-posting consumer transactions, every one
 * of them needs 1-2 extra ("nested") pool connections at the same moment
 * none is free, deadlocking the whole queue silently forever.
 *
 * This test exercises finance.gl.post on 13 independent journals for the
 * SAME tenant/legal-entity/cost-center at once — pool.max (10) + 3
 * concurrency, real Postgres, real pool — a realistic trigger (a
 * legal-entity-scoped tenant posting several GL entries, e.g. a batch of
 * bills/challans clearing, around the same moment).
 *
 * Fixed by routing postJournal()'s validateOrgAssignment(...) call onto
 * validateOrgAssignmentTx(tx, ...), which threads the caller's already-open
 * tx through all 4 asserts' own *Tx siblings instead of each one opening its
 * own transaction (org-structure/domain.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { registerGlConsumers } from "../src/modules/gl/consumer.js";
import { financeJournals } from "../src/modules/gl/schema.js";
import { legalEntities, costCenters } from "../src/modules/org-structure/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "18000000-0000-4000-8000-000000000001";
const ACTOR = "18000000-0000-4000-8000-0000000000aa";
const LEGAL_ENTITY = "18000000-0000-4000-8000-000000000002";
const COST_CENTER = "18000000-0000-4000-8000-000000000003";
const DEBIT_HEAD = randomUUID();
const CREDIT_HEAD = randomUUID();
// finance_journals carries UNIQUE(tenant_id, voucher_no), and (unlike
// legalEntities/costCenters) rows are never cleaned up between runs — see
// clean()'s comment. A fixed "TX018-<i>" voucher pattern reused across runs
// against a container/db that isn't recreated each time collides on that
// constraint, so each run gets its own random prefix.
const RUN_PREFIX = randomUUID().slice(0, 8);
// pool.max defaults to 10 (packages/db/src/pool.ts, DB_POOL_MAX) when not
// routed through pgbouncer, which is exactly the test DB's connection style
// (vitest.config.ts DATABASE_URL points straight at Postgres). +3 to clear it.
const CONCURRENCY = 13;
const JOURNAL_IDS = Array.from({ length: CONCURRENCY }, () => randomUUID());

/** Mirrors worker.ts's global subscribe wrap: every handler runs under the
 *  message's tenant GUC so FORCE RLS reads/writes succeed, exactly like
 *  production. gl/consumer.ts's registerGlConsumers() does not itself
 *  tenant-scope the queue (unlike notification/visitor-service's
 *  registerDeliveryConsumers()/registerVisitRequestConsumers()), matching
 *  this file's sibling nested-tx-deadlock.test.ts. */
function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, (msg: Parameters<Handler>[0]) => runWithTenant(msg.tenantId, () => handler(msg)))) as typeof q.subscribe;
  return q;
}

function makeMsg(type: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type, tenantId: TENANT,
    actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
    payload,
  };
}

async function clean() {
  // finance_journals is a deliberately immutable ledger — finance_svc holds
  // INSERT/SELECT/UPDATE but NOT DELETE (confirmed against the live schema:
  // journals are only ever reversed via a new contra journal, never hard-
  // deleted, see gl/consumer.ts's journalReverse handler). Nothing to clean
  // up there anyway: JOURNAL_IDS is freshly randomUUID()'d per test run, so
  // stale rows from an earlier run can never collide with this run's own
  // inserts or its `WHERE id IN (JOURNAL_IDS)` assertions.
  await withTenantScope(db, TENANT, (tx) =>
    tx.delete(costCenters).where(eq(costCenters.tenantId, TENANT)),
  );
  await withTenantScope(db, TENANT, (tx) =>
    tx.delete(legalEntities).where(eq(legalEntities.tenantId, TENANT)),
  );
}

beforeAll(async () => {
  await clean();
  await withTenantScope(db, TENANT, (tx) =>
    tx.insert(legalEntities).values({
      id: LEGAL_ENTITY, tenantId: TENANT, code: "TX018-LE", name: "TX-018 fixture legal entity",
      createdBy: ACTOR, updatedBy: ACTOR,
    }),
  );
  await withTenantScope(db, TENANT, (tx) =>
    tx.insert(costCenters).values({
      id: COST_CENTER, tenantId: TENANT, legalEntityId: LEGAL_ENTITY,
      code: "TX018-CC", name: "TX-018 fixture cost center",
      createdBy: ACTOR, updatedBy: ACTOR,
    }),
  );
});

afterAll(async () => { await clean(); await sqlClient.end(); });

describe("gl consumer finance.gl.post — org-structure nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent finance.gl.post commands, each carrying legalEntityId+costCenterId, drain without deadlocking the connection pool`,
    async () => {
      const q = tenantWrappedQueue();
      registerGlConsumers(q as unknown as Queue);
      await q.start();

      const today = new Date().toISOString().slice(0, 10);
      await Promise.all(JOURNAL_IDS.map((id, i) =>
        q.publish(COMMANDS.journalPost, makeMsg(COMMANDS.journalPost, {
          id, tenantId: TENANT, voucherNo: `TX018-${RUN_PREFIX}-${i}`, type: "journal", postingDate: today,
          legalEntityId: LEGAL_ENTITY, costCenterId: COST_CENTER,
          lines: [
            { accountCode: DEBIT_HEAD, debitMinor: "1000", creditMinor: "0" },
            { accountCode: CREDIT_HEAD, debitMinor: "0", creditMinor: "1000" },
          ],
        })),
      ));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms — nested-transaction pool deadlock regressed`).toBe(false);
      // MemoryQueue.deliver() swallows handler errors into q.dlq instead of
      // rejecting -- assert the DLQ is empty so a silent per-command failure
      // (e.g. every command timing out on the pool and erroring out, or an
      // org-structure validation throwing unexpectedly) isn't masked by a
      // "drained" queue.
      expect(q.dlq, `handler errors were swallowed into the DLQ: ${JSON.stringify(q.dlq)}`).toHaveLength(0);

      const rows = await withTenantScope(db, TENANT, (tx) =>
        tx.select().from(financeJournals).where(inArray(financeJournals.id, JOURNAL_IDS)),
      );
      expect(rows).toHaveLength(CONCURRENCY);
      for (const row of rows) {
        expect(row.status).toBe("posted");
        expect(row.legalEntityId).toBe(LEGAL_ENTITY);
        expect(row.costCenterId).toBe(COST_CENTER);
      }

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
