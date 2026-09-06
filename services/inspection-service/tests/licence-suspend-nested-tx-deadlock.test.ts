/**
 * inspection-service licenceSuspend nested-transaction connection-pool
 * deadlock regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: licenceSuspend (licence/consumer.ts) called repo.findLicenceById
 * -- scopedRead-based, opening its OWN db.transaction() -- from INSIDE its
 * own already-open outer db.transaction(). Real licence suspension under
 * concurrent regulatory-action load is a realistic trigger. Same shape as
 * notification-service (#1028), building-service (#1035), payroll-service
 * (#1042, #1048), finance-service (#1043), hrms-service (#1045, #1047),
 * grant-service (#1049), billing-service (#1050), and inspection-service
 * assignment (#1052), capa (#1055), checklist (#1056), enforcement (#1057),
 * and execution (#1059) modules.
 *
 * Fixed by routing licenceRenew/licenceSuspend/licenceRevoke onto
 * findLicenceByIdTx, reading directly through the already-open outer tx.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerLicenceConsumers } from "../src/modules/licence/consumer.js";
import { licences } from "../src/modules/licence/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "7b000000-dead-4000-8000-00000000110c";
const ACTOR = "7b000000-dead-4000-8000-0000000ac70a";
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

describe("inspection-service licenceSuspend -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent licenceSuspend commands (each against a real active licence row) drain without deadlocking the connection pool`,
    async () => {
      const licenceIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        const licenceId = randomUUID();
        licenceIds.push(licenceId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await withTenantScope(db, TENANT, (tx: any) => tx.insert(licences).values({
          id: licenceId, tenantId: TENANT, entityId: randomUUID(),
          licenceType: "fire_noc", licenceNumber: `LIC-DEADLOCK-${i}`,
          validFrom: "2025-01-01", validTo: "2027-01-01",
          status: "active",
          createdBy: ACTOR, updatedBy: ACTOR,
        }));
      }

      const q = tenantWrappedQueue();
      registerLicenceConsumers(q);
      await q.start();

      await Promise.all(licenceIds.map((licenceId) =>
        q.publish(COMMANDS.licenceSuspend, makeMsg(COMMANDS.licenceSuspend, {
          licenceId,
          reason: "Non-compliance with fire safety norms",
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
