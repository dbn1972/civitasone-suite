/**
 * TX-001 (ai-agent-service slice) -- protocols module nested-transaction
 * connection-pool deadlock regression.
 *
 * Found via the ENTERPRISE-GAP-REPORT-2026-09-07.md TX-001 sweep (evidence
 * column cited `ai-agent protocols:61`). Independently re-verified by a
 * manual, line-by-line scan of every db.transaction() block across all 8
 * consumer.ts files in this service (34 blocks total, cross-checked against
 * scan_nested_tx_v2.py's 1-genuine-finding result and against every bare
 * (non-tx) exported function in every repo.ts/*-repo.ts in the service) --
 * unlike every prior TX-001 slice (estab 31 vs 14, procurement 13 vs 8,
 * citizen 3 vs 2, install 7 vs 2, recommendation 3 vs 2), this service's
 * real count matches the evidence column exactly: exactly ONE genuine site.
 *
 *   1. `repo.findById(p.id, msg.tenantId)` (protocols/consumer.ts, was line 61)
 *
 * repo.findById() is defined via this service's `scopedRead()` helper
 * (src/shared/db.ts), which is a bare `db.transaction(fn)` -- same failure
 * shape as estab/procurement/parking's TX-001 fixes: every bare read repo
 * function in this service already opens its OWN transaction. Called from
 * INSIDE updateProtocol's already-open outer db.transaction(), it needs a
 * second, nested pool connection. Under pool.max concurrent in-flight
 * consumer transactions, no second connection is ever free and the whole
 * queue deadlocks silently forever.
 *
 * This test drives updateProtocol (ai.protocol.update) at pool.max + 3
 * concurrency, real Postgres, real pool, many tenants' protocol registrations
 * being patched at once (a realistic trigger -- e.g. a bulk endpoint-rotation
 * job). Fixed by routing the read onto repo.findByIdTx(tx, ...), reading
 * through the caller's already-open tx instead of opening a second one.
 *
 * Sabotage check (see PR body): reverting the call site back to the bare
 * findById() reproduces the drain timeout below.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { protocolRegistrations } from "../src/modules/protocols/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerProtocolConsumers } from "../src/modules/protocols/consumer.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "7a161000-dead-4000-8000-00000000f1a2";
const ACTOR = "7a161000-dead-4000-8000-0000000ac70b";
// pool.max defaults to 10 (packages/db/src/pool.ts, DB_POOL_MAX) when not
// routed through pgbouncer, which is exactly this test DB's connection style
// (vitest.config.ts DATABASE_URL points straight at Postgres). +3 to clear it.
const CONCURRENCY = 13;
const NEW_ENDPOINT = "https://tools.example.gov.in/mcp/v2";

function makeMsg(regId: string) {
  return {
    messageId: randomUUID(), type: COMMANDS.updateProtocol, tenantId: TENANT,
    actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
    payload: {
      id: regId, tenantId: TENANT, version: 1,
      patch: { endpoint: NEW_ENDPOINT }, enabled: true,
    },
  };
}

async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      // _inbox.processed has no tenantId column (just messageId + processedAt,
      // see packages/outbox/src/index.ts) -- messageIds here are always fresh
      // randomUUID()s per test run, so there is nothing of this tenant's to
      // clean there (same as estab/parking's TX-001 deadlock test precedent).
      await tx.delete(protocolRegistrations).where(eq(protocolRegistrations.tenantId, TENANT));
    }),
  );
}

let regIds: string[] = [];

beforeAll(async () => {
  await clean();
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      regIds = Array.from({ length: CONCURRENCY }, () => randomUUID());
      for (const [i, id] of regIds.entries()) {
        await tx.insert(protocolRegistrations).values({
          id, tenantId: TENANT, protocol: "mcp",
          endpoint: `https://tools.example.gov.in/mcp/v1/${i}`,
          capabilities: [{ name: "search", description: null, version: null }],
          enabled: true, version: 1,
          createdBy: ACTOR, updatedBy: ACTOR,
        });
      }
    }),
  );
});

afterAll(async () => { await clean(); await sqlClient.end(); });

describe("protocols consumer updateProtocol -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent updateProtocol commands across different registrations drain without deadlocking the connection pool`,
    async () => {
      const q = tenantScoped(new MemoryQueue());
      registerProtocolConsumers(q);
      await q.start();

      await Promise.all(regIds.map((id) => q.publish(COMMANDS.updateProtocol, makeMsg(id))));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);
      expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms -- nested-tx pool deadlock regressed`).toBe(false);
      // MemoryQueue.deliver() swallows handler errors into q.dlq instead of
      // rejecting -- assert the DLQ is empty so a silent per-command failure
      // isn't masked by a "drained" queue.
      expect((q as MemoryQueue).dlq, `handler errors were swallowed into the DLQ: ${JSON.stringify((q as MemoryQueue).dlq)}`).toHaveLength(0);
      await q.stop();

      const rows = await runWithTenant(TENANT, () =>
        db.transaction((tx) => tx.select().from(protocolRegistrations).where(inArray(protocolRegistrations.id, regIds))),
      );
      expect(rows).toHaveLength(CONCURRENCY);
      for (const row of rows) {
        // Every registration must have actually been patched AND version-bumped
        // -- proving the fix didn't just avoid the deadlock but that the nested
        // read (existence + version/protocol lookup) actually landed correctly
        // for every concurrent handler.
        expect(row.endpoint, `registration ${row.id} was not patched`).toBe(NEW_ENDPOINT);
        expect(row.version, `registration ${row.id} was not version-bumped`).toBe(2);
      }
    },
    { timeout: 20_000 },
  );
});
