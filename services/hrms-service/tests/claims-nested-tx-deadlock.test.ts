/**
 * hrms-service claims module nested-transaction connection-pool deadlock
 * regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: claims/f3-consumer.ts's "claims_routes__0" (LTC approve),
 * "claims_routes__1" (LTC reject), "claims_routes__2" (CEA approve) and
 * "claims_routes__3" (CEA reject) all called the scopedRead-based
 * repo.findLtc / repo.findCea / repo.ceaCommittedForChild from INSIDE their
 * own already-open outer db.transaction() -- a second transaction competing
 * for a connection from the same pool as the outer one, deadlocking every
 * in-flight command once concurrency reaches pool.max.
 *
 * This test exercises "claims_routes__0" (LTC approve, findLtc), which
 * also drives the version-guarded repo.updateLtc write, at pool.max + 3
 * concurrency, real Postgres, real pool.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerF3_claims_Consumers } from "../src/modules/claims/f3-consumer.js";
import { hrmsLtcClaims } from "../src/modules/claims/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "d0000000-dead-4000-8000-00000000c0de";
const ACTOR = "d0000000-dead-4000-8000-0000000ac70a";
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

async function seedSubmittedLtc(): Promise<string> {
  const claimId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsLtcClaims).values({
    id: claimId, tenantId: TENANT, employeeId: randomUUID(), blockYear: "2026-2029",
    ltcType: "hometown", journeyFrom: "Delhi", journeyTo: "Shimla", travelDate: "2026-06-01",
    familyMembers: 2, claimedFareMinor: 500000n, entitlementMinor: 400000n,
    status: "submitted", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  return claimId;
}

describe("claims consumer -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent claims_routes__0 (LTC approve) commands drain without deadlocking the connection pool`,
    async () => {
      const claimIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        claimIds.push(await seedSubmittedLtc());
      }

      const q = tenantWrappedQueue();
      registerF3_claims_Consumers(q);
      await q.start();

      await Promise.all(claimIds.map((claimId) =>
        q.publish(COMMANDS.f3RouteWrite, makeMsg({
          op: "claims_routes__0",
          tenantId: TENANT,
          params: { claimId },
          body: {},
        })),
      ));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms -- nested-transaction pool deadlock regressed`).toBe(false);
      expect(q.dlq, `handler errors were swallowed into the DLQ: ${JSON.stringify(q.dlq)}`).toHaveLength(0);

      // Prove real DB state, not just "didn't hang": every claim actually
      // moved to approved with the entitlement-capped fare (claimedFareMinor
      // 500000 > entitlementMinor 400000, so approvedFareMinor must be capped
      // at 400000, exactly as bmin(claimedFareMinor, entitlementMinor) does).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await withTenantScope(db, TENANT, (tx: any) =>
        tx.select().from(hrmsLtcClaims).where(eq(hrmsLtcClaims.tenantId, TENANT)),
      );
      const updated = rows.filter((r: { id: string }) => claimIds.includes(r.id));
      expect(updated).toHaveLength(CONCURRENCY);
      for (const row of updated) {
        expect(row.status).toBe("approved");
        expect(row.approvedFareMinor).toBe(400000n);
        expect(row.version).toBe(2);
      }

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
