/**
 * TX-001 (estab-service slice) — dfa module nested-transaction
 * connection-pool deadlock regression.
 *
 * Found via the ENTERPRISE-GAP-REPORT-2026-09-07.md TX-001 sweep: dfa's
 * consumer called repo.findDfaById -- a db.transaction()-based read that
 * opens its OWN transaction -- from INSIDE an already-open outer
 * db.transaction(), at five separate call sites (dfaUpdate, the
 * dfaSubmit/dfaSign status-transition helper, dfaReturn, dfaApprove,
 * dfaDispatch). Under pool.max concurrent in-flight consumer transactions,
 * every one of them needs a second ("nested") pool connection at the same
 * moment none is free, deadlocking the whole queue silently forever.
 *
 * This test exercises dfaUpdate (estab.dfa.update) at pool.max + 3
 * concurrency, real Postgres, real pool, each command updating a distinct
 * draft DFA (avoiding row-lock serialization so the test isolates the
 * pool-connection deadlock specifically, not ordinary row contention).
 *
 * Fixed by routing onto repo.findDfaByIdTx(tx, ...), reading through the
 * caller's already-open tx.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { estabDfa } from "../src/modules/dfa/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerDfaConsumers } from "../src/modules/dfa/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "d1a00000-dead-4000-8000-00000000d1a0";
const OFFICER = "d1a00000-dead-4000-8000-0000000ac70a";
// pool.max defaults to 10 (packages/db/src/pool.ts, DB_POOL_MAX) when not
// routed through pgbouncer, which is exactly the test DB's connection style
// (vitest.config.ts DATABASE_URL points straight at Postgres). +3 to clear it.
const CONCURRENCY = 13;

/** Mirrors production's createQueue() decoration: every handler runs under
 *  the message's tenant GUC so db.transaction() picks it up, exactly like
 *  production consumer wiring. */
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

function makeMsg(id: string, payload: Record<string, unknown>) {
  return {
    messageId: id, type: COMMANDS.dfaUpdate, tenantId: TENANT,
    actorId: OFFICER, correlationId: randomUUID(), schemaVersion: "1.0",
    payload,
  };
}

async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      await tx.delete(estabDfa).where(eq(estabDfa.tenantId, TENANT));
    }),
  );
}

afterAll(async () => { await clean(); await sqlClient.end(); });

describe("dfa consumer dfaUpdate -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent dfaUpdate commands (one distinct draft DFA each) drain without deadlocking the connection pool",
    async () => {
      await clean();
      const dfaIds = Array.from({ length: CONCURRENCY }, () => randomUUID());
      await runWithTenant(TENANT, () =>
        db.transaction(async (tx) => {
          for (let i = 0; i < CONCURRENCY; i++) {
            await tx.insert(estabDfa).values({
              id: dfaIds[i], tenantId: TENANT, dfaNo: "DFA/2026/TX001-" + i,
              communicationType: "letter", subject: "Original subject " + i,
              body: "Original body", status: "draft",
              createdBy: OFFICER, updatedBy: OFFICER,
            });
          }
        }),
      );

      const q = wireTenantAwareQueue(new MemoryQueue());
      registerDfaConsumers(q);
      await q.start();

      await Promise.all(dfaIds.map((id, i) =>
        q.publish(COMMANDS.dfaUpdate, makeMsg(randomUUID(), {
          id, tenantId: TENANT, patch: { subject: "Updated subject " + i },
        })),
      ));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, "queue did not drain within " + DRAIN_TIMEOUT_MS + "ms -- nested-transaction pool deadlock regressed").toBe(false);
      expect((q as MemoryQueue).dlq, "handler errors were swallowed into the DLQ: " + JSON.stringify((q as MemoryQueue).dlq)).toHaveLength(0);

      const rows = await runWithTenant(TENANT, () =>
        db.transaction((tx) => tx.select().from(estabDfa).where(inArray(estabDfa.id, dfaIds))),
      );
      expect(rows).toHaveLength(CONCURRENCY);
      const bySubject = new Map(rows.map((r) => [r.id, r.subject]));
      for (let i = 0; i < CONCURRENCY; i++) {
        expect(bySubject.get(dfaIds[i])).toBe("Updated subject " + i);
      }

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
