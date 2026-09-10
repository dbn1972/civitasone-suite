/**
 * TX-001 (audit-service slice) — events module nested-transaction
 * connection-pool deadlock regression.
 *
 * Found via the ENTERPRISE-GAP-REPORT-2026-09-07.md TX-001 sweep. The
 * evidence column named one site (`events:30`); manual audit (the fleet-wide
 * scanner has known blind spots, per TX-011) found TWO genuine sites, both
 * calling the same bare function:
 *
 *   - events/consumer.ts's handleAuditEvent (the audit.event.record /
 *     audit.event.ingest queue handler) calls repo.findLatestForTenant()
 *     bare, from inside its own already-open db.transaction().
 *   - events/repo.ts's writeEvent() (the direct API-path writer) ALSO calls
 *     the same bare repo.findLatestForTenant() from inside its own
 *     db.transaction() -- a second, independent nested-tx site the evidence
 *     column didn't mention at all.
 *
 * findLatestForTenant() opens its OWN db.transaction() internally (wrapped
 * in runWithTenant() for RLS GUC correctness on cross-tenant callers). Called
 * from inside an outer transaction, that nests a second db.transaction()
 * inside the first -- each needs its own pool connection. Under pool.max
 * concurrent in-flight consumer transactions, every nested call needs a
 * second pool connection at the same moment none is free, deadlocking the
 * whole queue silently forever.
 *
 * This test exercises handleAuditEvent (audit.event.record) for pool.max
 * (10) + 3 = 13 DIFFERENT tenants at once -- real Postgres, real pool.
 * Distinct tenants (rather than one tenant repeated) avoid the handler's own
 * pg_advisory_xact_lock(hashtext(tenantId)) serializing the runs and masking
 * pure connection-pool exhaustion.
 *
 * Fixed by routing both nested callers onto repo.findLatestForTenantTx(tx,
 * tenantId), reading through the caller's already-open tx.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";

const CONCURRENCY = 13;

/**
 * Test-harness fix: `new MemoryQueue()` used directly (not the production
 * `createQueue()` factory) does NOT auto-wrap subscribed handlers with
 * `withTenantConsumer`. Production wiring decorates `subscribe()` so every
 * consumer handler runs inside `runWithTenant(msg.tenantId, ...)`, which is
 * what lets `db.transaction()` pick up the tenant GUC. Mirror that here (same
 * helper as services/audit-service/tests/audit.test.ts and
 * services/install-service/tests/tx-001-orchestrator-nested-tx-deadlock.test.ts).
 */
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

describe("audit events consumer -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  let db: typeof import("../src/shared/db.js")["db"];
  let sqlClient: typeof import("../src/shared/db.js")["sqlClient"];
  let auditEvents: typeof import("../src/modules/events/schema.js")["auditEvents"];
  let registerAuditConsumers: typeof import("../src/modules/events/consumer.js")["registerAuditConsumers"];

  const ACTOR = randomUUID();
  const TENANTS = Array.from({ length: CONCURRENCY }, () => randomUUID());
  const MESSAGE_IDS = TENANTS.map(() => randomUUID());

  beforeAll(async () => {
    ({ db, sqlClient } = await import("../src/shared/db.js"));
    ({ auditEvents } = await import("../src/modules/events/schema.js"));
    ({ registerAuditConsumers } = await import("../src/modules/events/consumer.js"));
  });

  afterAll(async () => {
    await sqlClient.end();
  });

  it(
    CONCURRENCY + " concurrent audit.event.record messages for DIFFERENT tenants drain without deadlocking the connection pool",
    async () => {
      const q = wireTenantAwareQueue(new MemoryQueue());
      registerAuditConsumers(q);
      await q.start();

      await Promise.all(TENANTS.map((tenantId, i) =>
        q.publish("audit.event.record", {
          messageId: MESSAGE_IDS[i], type: "audit.event.record", tenantId,
          actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
          payload: {
            service: "tx-001-audit-test", action: "create",
            resourceType: "regression", resourceId: `tx001-${i}`,
            outcome: "success",
          },
        }),
      ));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, "queue did not drain within " + DRAIN_TIMEOUT_MS + "ms -- nested-transaction pool deadlock regressed").toBe(false);
      // MemoryQueue.deliver() swallows handler errors into q.dlq instead of
      // rejecting -- assert the DLQ is empty so a silent per-message failure
      // (e.g. every message timing out on the pool and erroring out) isn't
      // masked by a "drained" queue.
      expect((q as MemoryQueue).dlq, "handler errors were swallowed into the DLQ: " + JSON.stringify((q as MemoryQueue).dlq)).toHaveLength(0);

      // One row per tenant, each readable back through its own tenant scope
      // (append-only ledger -- rows are intentionally left in place, same as
      // audit.test.ts's DB-backed suite).
      for (let i = 0; i < TENANTS.length; i++) {
        const tenantId = TENANTS[i]!;
        const rows = await runWithTenant(tenantId, () =>
          db.transaction((tx) => tx.select().from(auditEvents).where(eq(auditEvents.tenantId, tenantId))),
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]!.type).toBe("audit.event.record");
      }

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
