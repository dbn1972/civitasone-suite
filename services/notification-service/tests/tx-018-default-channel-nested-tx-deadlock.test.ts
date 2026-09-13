/**
 * TX-018 (notification-service slice) — default-channel lookup
 * nested-transaction connection-pool deadlock regression.
 *
 * Found via the ENTERPRISE-GAP-REPORT-2026-09-07.md TX-018 sweep — the same
 * blind-spot class TX-011's nested-tx-guard.mjs was built to catch (and, on
 * its own first fleet-wide run, actually did catch this exact site):
 * deliveries/consumer.ts's send handler — while inside its own already-open
 * db.transaction() — called resolveChannelWithDefault(), which (when the
 * resolved preferred channel has no registered adapter) calls
 * channelQueries.getDefaultChannel(), which calls repo.findDefaultChannel(),
 * an unconditional scopedRead() (= its own nested db.transaction()). Under
 * pool.max concurrent in-flight send-consumer transactions, every one of
 * them needing an extra ("nested") pool connection at the same moment none
 * is free deadlocks the whole queue silently forever.
 *
 * REACHABILITY NOTE (why this test does not drive the bug through the real
 * queue/consumer end-to-end, unlike this gap's finance-service and
 * visitor-service regression tests): every one of this fleet's 6 channel
 * adapters (email/sms/push/in_app/whatsapp/webhook — adapters/index.ts) is
 * unconditionally instantiated at module load, e.g. `export const
 * pushAdapter = new PushAdapter()` regardless of whether
 * NOTIFICATION_PUSH_DRIVER is set — an adapter can fail at *send* time if
 * unconfigured, but getAdapter(type) is never falsy for any of those 6
 * names. resolvePreferredChannel() (channel.ts) can only ever produce one of
 * those same 6 names (an explicit channel is accepted only when
 * getAdapter(explicit) is already truthy; every prefs-derived value and the
 * final default are hardcoded to push/in_app/email/sms/whatsapp/"email").
 * So resolveChannelWithDefault()'s `if (getAdapter(preferred)) return
 * preferred;` early return fires on every real call today, and
 * getDefaultChannel() is unreachable through processSend() as the fleet's
 * adapters are configured — a pre-existing property of this code, not
 * something introduced or fixed by TX-018. That does not make the nested-tx
 * shape inside getDefaultChannel()/findDefaultChannel() any less real (a
 * future adapter removal, or a genuinely custom per-tenant channel type,
 * would make it reachable again), so it still needs the same *Tx fix as
 * every other TX-018/TX-001 site — it just means the regression proof below
 * drives the actual two-hop nested chain the gap names
 * (getDefaultChannelTx -> findDefaultChannelTx) directly from inside a real,
 * concurrently-open outer db.transaction(), via a minimal test-only
 * MemoryQueue handler standing in for the unreachable branch of
 * processSend(), rather than through registerDeliveryConsumers() itself.
 * Same real Postgres, same real pool, same pool.max+3 concurrency, same
 * nested-open-transaction shape as every other TX-018 test.
 *
 * Fixed by routing resolveChannelWithDefault() -> resolveChannelWithDefaultTx(tx, ...)
 * in deliveries/consumer.ts, which threads the caller's tx through
 * getDefaultChannelTx() -> findDefaultChannelTx() instead of each opening
 * its own transaction (deliveries/channel.ts, channels/queries.ts,
 * channels/repo.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { notificationChannels } from "../src/modules/channels/schema.js";
import { getDefaultChannelTx } from "../src/modules/channels/queries.js";
import { resolveChannelWithDefaultTx } from "../src/modules/deliveries/channel.js";

const TENANT = "18000000-0000-4000-8000-000000000118";
const ACTOR = "18000000-0000-4000-8000-0000000000bb";
// notification_channels.type is DB-constrained (chk_channels_type) to
// exactly these 5 values — confirming the REACHABILITY NOTE above from a
// second angle: even a hand-crafted row can never carry a channel.type
// without a registered adapter. Irrelevant to getDefaultChannelTx /
// findDefaultChannelTx either way — they do no adapter check themselves,
// only the lookup-by-type filter this test exercises.
const CHANNEL_TYPE = "sms";
// pool.max defaults to 10 (packages/db/src/pool.ts, DB_POOL_MAX) when not
// routed through pgbouncer, which is exactly the test DB's connection style
// (vitest.config.ts DATABASE_URL points straight at Postgres). +3 to clear it.
const CONCURRENCY = 13;

/** Mirrors worker.ts's global subscribe wrap: every handler runs under the
 *  message's tenant GUC so FORCE RLS reads/writes succeed, exactly like
 *  production (and like the install-service TX-001 reference test this
 *  harness is modeled on). */
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
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
  await runWithTenant(TENANT, () =>
    db.transaction((tx) => tx.delete(notificationChannels).where(eq(notificationChannels.tenantId, TENANT))),
  );
}

beforeAll(async () => {
  await clean();
  await runWithTenant(TENANT, () =>
    db.transaction((tx) => tx.insert(notificationChannels).values({
      id: randomUUID(), tenantId: TENANT, type: CHANNEL_TYPE, name: "TX-018 fixture default channel",
      isDefault: true, enabled: true, createdBy: ACTOR, updatedBy: ACTOR,
    })),
  );
});

afterAll(async () => { await clean(); await sqlClient.end(); });

describe("channels default-channel lookup — nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent default-channel lookups, each nested inside its own already-open outer transaction, drain without deadlocking the connection pool`,
    async () => {
      const q = wireTenantAwareQueue(new MemoryQueue());
      const found: string[] = [];
      q.subscribe("tx018.lookup", async (msg: { tenantId: string }) => {
        // Mirrors the exact nested shape the gap names: an outer consumer
        // transaction (deliveries/consumer.ts's send handler) reading the
        // tenant's default channel through the *Tx chain instead of opening
        // a second, nested transaction from inside itself.
        await db.transaction(async (tx) => {
          const channel = await getDefaultChannelTx(tx, msg.tenantId, CHANNEL_TYPE);
          if (channel) found.push(channel.id);
        });
      });
      await q.start();

      await Promise.all(Array.from({ length: CONCURRENCY }, () =>
        q.publish("tx018.lookup", makeMsg("tx018.lookup", { tenantId: TENANT })),
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
      // isn't masked by a "drained" queue.
      expect((q as MemoryQueue).dlq, `handler errors were swallowed into the DLQ: ${JSON.stringify((q as MemoryQueue).dlq)}`).toHaveLength(0);
      // State assertion: every one of the 13 nested reads actually found and
      // returned the fixture row, not just "didn't crash".
      expect(found).toHaveLength(CONCURRENCY);

      await q.stop();
    },
    { timeout: 20_000 },
  );

  it("resolveChannelWithDefaultTx threads tx through end-to-end and still returns the correct (adapter-backed) channel on the reachable path", async () => {
    // Documented in the REACHABILITY NOTE above: with no prefs and no
    // explicit channel, resolution lands on "email", which always has a
    // registered adapter — so this exercises resolveChannelWithDefaultTx's
    // own early-return branch (the one every real call takes today) with a
    // real caller-supplied tx, proving the signature change/threading itself
    // is correct end-to-end, independent of the concurrency proof above.
    await db.transaction(async (tx) => {
      const channel = await resolveChannelWithDefaultTx(tx, TENANT, [], undefined, undefined);
      expect(channel).toBe("email");
    });
  });
});
