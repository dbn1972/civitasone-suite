/**
 * hrms-service recruitment module nested-transaction connection-pool deadlock
 * regression -- offer path. See
 * .claude/skills/16-production-readiness-audit.md section 1 and
 * requisition-nested-tx-deadlock.test.ts for the full background.
 *
 * This test exercises "recruitment_offer_routes__1" (submit offer for
 * approval): offerRepo.findOfferTx reads the offer (for the
 * optimistic-version guard) from inside the outer transaction, then
 * offerRepo.updateOffer moves it to pending_approval and
 * offerRepo.insertEvent records the audit trail, at pool.max + 3
 * concurrency, real Postgres, real pool.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerF3_recruitment_Consumers } from "../src/modules/recruitment/f3-consumer.js";
import { hrmsOffers, hrmsOfferEvents } from "../src/modules/recruitment/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "d0000000-dead-4000-8000-000000010de0";
const ACTOR = "d0000000-dead-4000-8000-0000000ac70e";
const CONCURRENCY = 13; // pool.max (10) + 3

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
    messageId: randomUUID(), type: COMMANDS.f3RouteWrite, tenantId: TENANT,
    actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload,
  };
}

async function seedDraftOffer(): Promise<string> {
  const offerId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsOffers).values({
    id: offerId, tenantId: TENANT, applicationId: randomUUID(),
    offerNo: "OFR-" + offerId.slice(0, 8).toUpperCase(), status: "draft",
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  return offerId;
}

describe("recruitment consumer -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent recruitment_offer_routes__1 (submit offer) commands drain without deadlocking the connection pool",
    async () => {
      const offerIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        offerIds.push(await seedDraftOffer());
      }

      const q = tenantWrappedQueue();
      registerF3_recruitment_Consumers(q);
      await q.start();

      await Promise.all(offerIds.map((offerId) =>
        q.publish(COMMANDS.f3RouteWrite, makeMsg({
          op: "recruitment_offer_routes__1",
          tenantId: TENANT,
          params: { offerId },
          body: {},
        })),
      ));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, "queue did not drain within " + DRAIN_TIMEOUT_MS + "ms -- nested-transaction pool deadlock regressed").toBe(false);
      expect(q.dlq, "handler errors were swallowed into the DLQ: " + JSON.stringify(q.dlq)).toHaveLength(0);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await withTenantScope(db, TENANT, (tx: any) =>
        tx.select().from(hrmsOffers).where(inArray(hrmsOffers.id, offerIds)),
      );
      expect(rows).toHaveLength(CONCURRENCY);
      for (const row of rows) {
        expect(row.status).toBe("pending_approval");
        expect(row.currentStage).toBe(0);
        expect(row.version).toBe(2);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const events = await withTenantScope(db, TENANT, (tx: any) =>
        tx.select().from(hrmsOfferEvents).where(inArray(hrmsOfferEvents.offerId, offerIds)),
      );
      const submitEvents = events.filter((e: { action: string }) => e.action === "submit");
      expect(submitEvents).toHaveLength(CONCURRENCY);

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
