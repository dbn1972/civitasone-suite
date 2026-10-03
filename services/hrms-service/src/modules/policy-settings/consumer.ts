import type { Queue } from "@civitasone/queue";
import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { hrmsPolicySettings } from "./schema.js";
import * as repo from "./repo.js";
import { POLICY_SCHEMAS, isPolicyKey, resolvePolicy } from "./registry.js";

const AUDIT = "audit.event.record";

export function registerPolicySettingsConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
  queue.subscribe(COMMANDS.policySettingSet, async (msg) => {
    const p = msg.payload as { tenantId: string; key: string; value: unknown };
    const key = p.key;
    if (!isPolicyKey(key)) return;
    // Re-validate: the queue is a trust boundary too.
    const parsed = (POLICY_SCHEMAS[key] as unknown as { safeParse: (v: unknown) => { success: boolean; data?: unknown } }).safeParse(p.value);
    if (!parsed.success) return;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const before = (await tx.select({ value: hrmsPolicySettings.value }).from(hrmsPolicySettings)
        .where(and(eq(hrmsPolicySettings.tenantId, p.tenantId), eq(hrmsPolicySettings.key, key))).limit(1))[0]?.value;
      await repo.upsertPolicy(tx, p.tenantId, key, parsed.data, msg.actorId);
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "hrms", action: "update", resourceType: "policy_setting", resourceId: key, outcome: "success",
          metadata: { key, before: resolvePolicy(key, before), after: parsed.data },
        },
      });
    });
  });
}
