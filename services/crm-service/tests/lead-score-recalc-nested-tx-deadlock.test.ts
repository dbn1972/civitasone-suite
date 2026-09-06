/**
 * crm-service lead-score-recalculation nested-transaction connection-pool
 * deadlock regression. Found via independent review of PR #1064 (see
 * .claude/skills/16-production-readiness-audit.md section 1): the
 * LEAD_SCORE_RECALC command handler and crm.contact.updated event handler
 * (leads/consumer.ts) both open db.transaction() and call recalculateScore(tx, ...),
 * which called getTenantScoringRules -> score-rules-repo.getScoringRules ->
 * getStoredRules, a scopedRead-based function that opens its OWN db.transaction()
 * (twice, on the lazy-seed path exercised here) from INSIDE the already-open
 * outer transaction. Same shape as the 14 sites already fixed in this PR
 * (contacts/deals/activities consumers) -- this is the 15th, missed by the
 * original scan because it is reached through two layers of indirection
 * (getTenantScoringRules -> scoreRulesRepo.getScoringRules) rather than a
 * direct repo call from the consumer.
 *
 * Fixed by routing onto getTenantScoringRulesTx / getScoringRulesTx /
 * getStoredRulesTx, reading (and lazy-seeding) through the caller's already-open tx.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerLeadScoringConsumers, LEAD_SCORE_RECALC } from "../src/modules/leads/consumer.js";
import { contacts } from "../src/modules/contacts/schema.js";
import { leadScoreRules } from "../src/modules/leads/score-rules-schema.js";
import { eq } from "drizzle-orm";
import { tenantScoped } from "../src/shared/tenant-queue.js";

const TENANT = "5c0a0000-dead-4000-8000-0000005c0533";
const ACTOR = "5c0a0000-dead-4000-8000-0000000ac70a";
const CONCURRENCY = 13; // pool.max (10) + 3

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

describe("crm-service LEAD_SCORE_RECALC -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent LEAD_SCORE_RECALC commands, on the lazy-seed (no rules configured yet) path, drain without deadlocking the connection pool",
    async () => {
      // Ensure the lazy-seed path is genuinely exercised: no scoring rules
      // configured for this tenant yet, so getStoredRulesTx must both SELECT
      // and INSERT the defaults through the caller's tx.
      await runWithTenant(TENANT, async () => {
        await db.transaction(async (tx) => {
          await tx.delete(leadScoreRules).where(eq(leadScoreRules.tenantId, TENANT));
        });
      });

      const contactIds: string[] = [];
      await runWithTenant(TENANT, async () => {
        await db.transaction(async (tx) => {
          for (let i = 0; i < CONCURRENCY; i++) {
            const contactId = randomUUID();
            contactIds.push(contactId);
            await tx.insert(contacts).values({
              id: contactId, tenantId: TENANT, name: "Score Test Contact " + randomUUID(),
              leadSource: "referral", company: "Acme", email: "lead" + i + "-" + randomUUID() + "@example.com",
              createdBy: ACTOR, updatedBy: ACTOR,
            });
          }
        });
      });

      // registerLeadScoringConsumers subscribes on the queue it's given as-is
      // (unlike contacts/consumer.ts, it does not call tenantScoped() itself);
      // in production that's fine because createQueue() universally decorates
      // subscribe() with withTenantConsumer, but a bare `new MemoryQueue()` in a
      // test has no tenant context at handler-execution-time, so RLS silently
      // returns zero rows and recalculateScore exits early -- never reaching
      // the nested-tx code at all. Wrap with tenantScoped() to match prod.
      const q = tenantScoped(new MemoryQueue());
      registerLeadScoringConsumers(q);
      await q.start();

      await Promise.all(contactIds.map((contactId) =>
        q.publish(LEAD_SCORE_RECALC, makeMsg(LEAD_SCORE_RECALC, { contactId, tenantId: TENANT })),
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
