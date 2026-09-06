/**
 * inspection-service templatePublish nested-transaction connection-pool
 * deadlock regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: templatePublish (checklist/consumer.ts) -- and its siblings
 * instanceGenerate/instanceSubmitResponse -- called repo.findTemplateById /
 * repo.findInstanceById, scopedRead-based (and cache-wrapped) functions
 * that each open their OWN db.transaction(), from INSIDE their own
 * already-open outer db.transaction(). Real checklist-template workflow
 * commands under concurrent load is a realistic trigger. Same shape as
 * notification-service (#1028), building-service (#1035), payroll-service
 * (#1042, #1048), finance-service (#1043), hrms-service (#1045, #1047),
 * grant-service (#1049), billing-service (#1050), inspection-service
 * assignment (#1052) and capa (#1055) modules.
 *
 * Fixed by routing onto findTemplateByIdTx / findInstanceByIdTx, reading
 * through the caller's already-open tx (and deliberately bypassing the
 * read-through cache).
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerChecklistConsumers } from "../src/modules/checklist/consumer.js";
import { checklistTemplates } from "../src/modules/checklist/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "c4ec0000-dead-4000-8000-00000000c4ec";
const ACTOR = "c4ec0000-dead-4000-8000-0000000ac70a";
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

describe("inspection-service templatePublish -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent templatePublish commands (each with a real draft template row) drain without deadlocking the connection pool`,
    async () => {
      const templateIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        const templateId = randomUUID();
        templateIds.push(templateId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await withTenantScope(db, TENANT, (tx: any) => tx.insert(checklistTemplates).values({
          id: templateId, tenantId: TENANT, name: `Template ${i}`,
          code: `tpl-${randomUUID().slice(0, 8)}`, versionNumber: 1, status: "draft",
          sections: [{ title: "S1", questions: [] }],
          createdBy: ACTOR, updatedBy: ACTOR,
        }));
      }

      const q = tenantWrappedQueue();
      registerChecklistConsumers(q);
      await q.start();

      await Promise.all(templateIds.map((templateId) =>
        q.publish(COMMANDS.templatePublish, makeMsg(COMMANDS.templatePublish, { templateId, version: 1 })),
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
