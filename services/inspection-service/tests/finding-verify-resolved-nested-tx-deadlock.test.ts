/**
 * inspection-service findingVerifyResolved nested-transaction connection-pool
 * deadlock regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: findingVerifyResolved (findings/consumer.ts) -- and its siblings
 * complianceNoticeCreate/findingSoftDelete/findingCreate -- called
 * repo.findFindingById (or, for findingCreate, universe/repo.findProvisionById;
 * findingSoftDelete additionally calls execution/repo.findInspectionById), all
 * scopedRead-based (and cache-wrapped) functions that open their OWN
 * db.transaction(), from INSIDE their own already-open outer db.transaction().
 * Real finding-verification workflow commands under concurrent load is a
 * realistic trigger. Same shape as notification-service (#1028),
 * building-service (#1035), payroll-service (#1042, #1048), finance-service
 * (#1043), hrms-service (#1045, #1047), grant-service (#1049),
 * billing-service (#1050), inspection-service assignment (#1052), capa
 * (#1055), checklist (#1056), enforcement (#1057), and execution (#1059)
 * modules.
 *
 * Fixed by routing onto findFindingByIdTx, reading through the caller's
 * already-open tx (and deliberately bypassing the read-through cache).
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerFindingsConsumers } from "../src/modules/findings/consumer.js";
import { findings } from "../src/modules/findings/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "f1d16000-dead-4000-8000-00000f1d1600";
const ACTOR = "f1d16000-dead-4000-8000-0000000f1d16";
const CONCURRENCY = 13; // pool.max (10) + 3

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

describe("inspection-service findingVerifyResolved -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent findingVerifyResolved commands (each with a real open finding row) drain without deadlocking the connection pool`,
    async () => {
      const findingIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        const findingId = randomUUID();
        findingIds.push(findingId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await withTenantScope(db, TENANT, (tx: any) => tx.insert(findings).values({
          id: findingId, tenantId: TENANT, findingNumber: `FND-2026-${randomUUID().slice(0, 8)}`,
          inspectionId: randomUUID(), questionId: randomUUID(), provisionId: randomUUID(),
          severity: "major", description: "fire exit blocked", state: "open",
          evidenceIds: [], createdBy: ACTOR, updatedBy: ACTOR,
        }));
      }

      const q = tenantWrappedQueue();
      registerFindingsConsumers(q);
      await q.start();

      await Promise.all(findingIds.map((findingId) =>
        q.publish(COMMANDS.findingVerifyResolved, makeMsg(COMMANDS.findingVerifyResolved, {
          findingId, verificationEvidenceIds: [randomUUID()], verifierNotes: "resolved on-site",
        })),
      ));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms -- nested-transaction pool deadlock regressed`).toBe(false);

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
