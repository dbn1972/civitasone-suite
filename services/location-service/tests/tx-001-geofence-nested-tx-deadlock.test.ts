/**
 * TX-001 (location-service slice) — geofence module nested-transaction
 * connection-pool deadlock regression.
 *
 * Found via the ENTERPRISE-GAP-REPORT-2026-09-07.md TX-001 sweep (evidence
 * column: `location geofence:55`). geofence/consumer.ts's geofenceCheck
 * handler reads the geofence via repo.findById(), which internally routes
 * through scopedRead() (shared/db.ts) -- itself a db.transaction() under the
 * hood, needed so the RLS tenant GUC is set on the read. Calling it from
 * inside the handler's own already-open db.transaction() opens a SECOND,
 * nested db.transaction() from inside the first: under pool.max concurrent
 * in-flight consumer transactions, the nested call has no free pool
 * connection to open on and deadlocks the pool silently forever.
 *
 * This test exercises geofenceCheck (location.geofence.check) against 13
 * independent geofences at once -- pool.max (10) + 3 concurrency, real
 * Postgres, real pool.
 *
 * Fixed by routing the nested read onto repo.findByIdTx(tx, ...), reading
 * through the caller's already-open tx (1 call site: geofenceCheck).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { geofences } from "../src/modules/geofence/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerGeofenceConsumers } from "../src/modules/geofence/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const TENANT = "0155e000-dead-4000-8000-000000000155";
const OFFICER = "0155e000-dead-4000-8000-0000000ac70a";
// pool.max defaults to 10 (packages/db/src/pool.ts, DB_POOL_MAX) when not
// routed through pgbouncer, which is exactly the test DB's connection style
// (vitest.config.ts DATABASE_URL points straight at Postgres). +3 to clear it.
const CONCURRENCY = 13;
const GEOFENCE_IDS = Array.from({ length: CONCURRENCY }, () => randomUUID());
const MESSAGE_IDS = Array.from({ length: CONCURRENCY }, () => randomUUID());

/**
 * Test-harness fix: `new MemoryQueue()` used directly (not the production
 * `createQueue()` factory) does NOT auto-wrap subscribed handlers with
 * `withTenantConsumer`. Production wiring (worker.ts) decorates
 * `queue.subscribe()` so every consumer handler runs inside
 * `runWithTenant(msg.tenantId, ...)`, which is what lets `db.transaction()`
 * pick up the tenant GUC. Mirror that here.
 */
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

function makeMsg(type: string, messageId: string, payload: Record<string, unknown>) {
  return {
    messageId, type, tenantId: TENANT,
    actorId: OFFICER, correlationId: randomUUID(), schemaVersion: "1.0",
    payload,
  };
}

async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      await tx.delete(processed).where(inArray(processed.messageId, MESSAGE_IDS));
      await tx.delete(geofences).where(inArray(geofences.id, GEOFENCE_IDS));
    }),
  );
}

beforeAll(async () => {
  await clean();
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      // 13 INDEPENDENT geofences so all 13 geofenceCheck commands can
      // legitimately run at once -- a realistic trigger (many field devices
      // checking in around the same moment), not an artificial one.
      await tx.insert(geofences).values(
        GEOFENCE_IDS.map((id, i) => ({
          id, tenantId: TENANT, name: `TX-001 geofence ${i}`, type: "zone" as const,
          centerLat: 20.0 + i * 0.01, centerLng: 85.0 + i * 0.01, radiusMeters: 500,
          polygon: null, active: true, createdBy: OFFICER, updatedBy: OFFICER, version: 1,
        })),
      );
    }),
  );
});

afterAll(async () => { await clean(); await sqlClient.end(); });

describe("geofence consumer geofenceCheck -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent geofenceCheck commands on independent geofences drain without deadlocking the connection pool",
    async () => {
      const q = wireTenantAwareQueue(new MemoryQueue());
      registerGeofenceConsumers(q);
      await q.start();

      await Promise.all(GEOFENCE_IDS.map((geofenceId, i) =>
        q.publish(COMMANDS.geofenceCheck, makeMsg(COMMANDS.geofenceCheck, MESSAGE_IDS[i]!, {
          geofenceId, lat: 20.0 + i * 0.01, lng: 85.0 + i * 0.01,
        })),
      ));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, "queue did not drain within " + DRAIN_TIMEOUT_MS + "ms -- nested-transaction pool deadlock regressed").toBe(false);
      // MemoryQueue.deliver() swallows handler errors into q.dlq instead of
      // rejecting -- assert the DLQ is empty so a silent per-command failure
      // (e.g. every command timing out on the pool and erroring out) isn't
      // masked by a "drained" queue.
      expect((q as MemoryQueue).dlq, "handler errors were swallowed into the DLQ: " + JSON.stringify((q as MemoryQueue).dlq)).toHaveLength(0);

      // Idempotency marker: every message was actually processed once.
      const processedRows = await runWithTenant(TENANT, () =>
        db.transaction((tx) => tx.select().from(processed).where(inArray(processed.messageId, MESSAGE_IDS))),
      );
      expect(processedRows).toHaveLength(CONCURRENCY);

      // Each geofenceCheck emits 2 outbox rows (location.geofence.checked +
      // audit.event.record) inside the SAME transaction as markProcessed --
      // if the nested read had deadlocked, these would never have been written.
      const outboxRows = await runWithTenant(TENANT, () =>
        db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))),
      );
      expect(outboxRows).toHaveLength(CONCURRENCY * 2);
      const checkedEvents = outboxRows.filter((r) => r.eventType === EVENTS.geofenceChecked);
      expect(checkedEvents).toHaveLength(CONCURRENCY);
      for (const row of checkedEvents) {
        const payload = row.payload as { geofenceId: string; inside: boolean };
        expect(GEOFENCE_IDS).toContain(payload.geofenceId);
        // Each check point is exactly the geofence's own center -> always inside.
        expect(payload.inside).toBe(true);
      }

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
