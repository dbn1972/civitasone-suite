/**
 * crm-service createContact nested-transaction connection-pool deadlock
 * regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: createContact (contacts/consumer.ts) -- and its siblings
 * across contacts/updateContact, contacts/mergeContacts,
 * contacts/merge-consumer.ts (mergeLeads), deals/consumer.ts (createDeal,
 * updateDeal), activities/consumer.ts (createActivity, x3 cross-tenant
 * guards in one transaction), and activities/notification-delivery-consumer.ts
 * -- called repo.accountExists / repo.contactExists / repo.findActiveRow /
 * dealRepo.dealExists, functions that open their OWN db.transaction()
 * (either directly via scopedRead, or via the equivalent tenantTransaction
 * helper -- same underlying shape, same bug), from INSIDE their own
 * already-open outer db.transaction(). Real contact-creation under
 * concurrent load is a realistic trigger. Same shape as notification-service
 * (#1028), building-service (#1035), payroll-service (#1042, #1048),
 * finance-service (#1043), hrms-service (#1045, #1047), grant-service
 * (#1049), billing-service (#1050), inspection-service (#1052, #1055,
 * #1056, #1057, #1059, #1060, #1061, #1062), and asset-service (#1063).
 *
 * Fixed by routing onto accountExistsTx / contactExistsTx / findActiveRowTx
 * / dealExistsTx, reading through the callers already-open tx.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerContactConsumers } from "../src/modules/contacts/consumer.js";
import { accounts } from "../src/modules/contacts/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "c2c00000-dead-4000-8000-00000000c2c0";
const ACTOR = "c2c00000-dead-4000-8000-0000000ac70a";
const CONCURRENCY = 13; // pool.max (10) + 3

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

describe("crm-service createContact -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent createContact commands (each referencing a real account) drain without deadlocking the connection pool",
    async () => {
      const accountId = randomUUID();
      await runWithTenant(TENANT, async () => {
        await db.transaction(async (tx) => {
          await tx.insert(accounts).values({
            id: accountId, tenantId: TENANT, name: "Test Account " + randomUUID(),
            createdBy: ACTOR, updatedBy: ACTOR,
          });
        });
      });

      const q = new MemoryQueue();
      registerContactConsumers(q);
      await q.start();

      await Promise.all(Array.from({ length: CONCURRENCY }, () =>
        q.publish(COMMANDS.createContact, makeMsg(COMMANDS.createContact, {
          id: randomUUID(), tenantId: TENANT, name: "Test Contact",
          leadStatus: "new", accountId, country: "IN",
        })),
      ));

      const DRAIN_TIMEOUT_MS = 10000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, "queue did not drain within " + DRAIN_TIMEOUT_MS + "ms -- nested-transaction pool deadlock regressed").toBe(false);

      await q.stop();
    },
    { timeout: 20000 },
  );
});
