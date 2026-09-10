/**
 * TX-001 (citizen-service slice) — helpdesk module nested-transaction
 * connection-pool deadlock regression.
 *
 * Found via the ENTERPRISE-GAP-REPORT-2026-09-07.md TX-001 sweep (the gap
 * row's evidence column only named `helpdesk:122`; a deep scan of the
 * consumer.ts body -- not just the evidence column -- turned up a SECOND
 * call site at line 152 for the same bare function):
 *   - COMMANDS.ticketEscalate  (consumer.ts ~122)
 *   - COMMANDS.ticketSlaCheck  (consumer.ts ~152)
 * Both call `repo.countEscalationsForTicket(tenantId, ticketId)` -- a
 * db.transaction()-based read that opens its OWN transaction -- from INSIDE
 * an already-open outer db.transaction(). Under pool.max concurrent
 * in-flight consumer transactions, every one of them needs a second
 * ("nested") pool connection at the same moment none is free, deadlocking
 * the whole queue silently forever.
 *
 * This test exercises ticketEscalate across many DIFFERENT tickets at
 * pool.max + 3 concurrency, real Postgres, real pool -- a realistic trigger
 * (a fleet of officers escalating unrelated tickets at the same moment).
 *
 * Fixed by routing onto repo.countEscalationsForTicketTx(tx, ...), reading
 * through the caller's already-open tx.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue, type Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { citizenTickets, ticketEscalations } from "../src/modules/helpdesk/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerHelpdeskConsumers } from "../src/modules/helpdesk/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "de1d0000-dead-4000-8000-000000000001";
const CITIZEN = "de1d0000-dead-4000-8000-0000000c1712";
// pool.max defaults to 10 (packages/db/src/pool.ts, DB_POOL_MAX) when not
// routed through pgbouncer, which is exactly the test DB's connection style
// (vitest.config.ts DATABASE_URL points straight at Postgres). +3 to clear it.
const CONCURRENCY = 13;

function makeMsg(id: string, type: string, payload: Record<string, unknown>) {
  return {
    messageId: id, type, tenantId: TENANT,
    actorId: CITIZEN, correlationId: randomUUID(), schemaVersion: "1.0",
    payload,
  };
}

async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      await tx.delete(ticketEscalations).where(eq(ticketEscalations.tenantId, TENANT));
      await tx.delete(citizenTickets).where(eq(citizenTickets.tenantId, TENANT));
    }),
  );
}

const ticketIds = Array.from({ length: CONCURRENCY }, () => randomUUID());

beforeAll(async () => {
  await clean();
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      for (const id of ticketIds) {
        await tx.insert(citizenTickets).values({
          id, tenantId: TENANT, citizenId: CITIZEN,
          ticketNo: `HD-TX001-${id.slice(0, 8)}`, subject: "TX-001 deadlock fixture",
          description: "seeded for helpdesk nested-tx regression test",
          status: "open", priority: "medium", category: "general", channel: "web",
          createdBy: CITIZEN, updatedBy: CITIZEN,
        });
      }
    }),
  );
});

afterAll(async () => { await clean(); await sqlClient.end(); });

describe("helpdesk consumer ticketEscalate -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent ticketEscalate commands on DIFFERENT tickets drain without deadlocking the connection pool",
    async () => {
      const q: Queue = new MemoryQueue();
      registerHelpdeskConsumers(q);
      await q.start();

      const escalationIds = ticketIds.map(() => randomUUID());

      await Promise.all(ticketIds.map((ticketId, i) =>
        q.publish(COMMANDS.ticketEscalate, makeMsg(randomUUID(), COMMANDS.ticketEscalate, {
          id: escalationIds[i], ticketId, tenantId: TENANT,
          reason: "Concurrent escalation " + i,
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
      // isn't masked by a "drained" queue.
      expect((q as MemoryQueue).dlq, "handler errors were swallowed into the DLQ: " + JSON.stringify((q as MemoryQueue).dlq)).toHaveLength(0);

      const rows = await runWithTenant(TENANT, () =>
        db.transaction((tx) => tx.select().from(ticketEscalations).where(inArray(ticketEscalations.id, escalationIds))),
      );
      expect(rows).toHaveLength(CONCURRENCY);
      for (const row of rows) {
        expect(row.level).toBe(1);
        expect(ticketIds).toContain(row.ticketId);
      }

      const tickets = await runWithTenant(TENANT, () =>
        db.transaction((tx) => tx.select().from(citizenTickets).where(inArray(citizenTickets.id, ticketIds))),
      );
      for (const t of tickets) {
        expect(t.priority).toBe("high");
      }

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
