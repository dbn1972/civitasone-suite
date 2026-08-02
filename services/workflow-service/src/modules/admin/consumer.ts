import type { Queue } from "@civitasone/queue";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { db } from "../../shared/db.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { subscribeWithDlq } from "../dlq/wrap.js";
import { roleMembers } from "../assignment/resolver.js";
import { COMMANDS, EVENTS } from "../../topics.js";
export function registerAdminConsumers(queue: Queue): void {
  queue = tenantScoped(queue);
  subscribeWithDlq<{ id: string; tenantId: string; roleRef: string; userId: string; reportsTo?: string; active: boolean }>(queue, COMMANDS.upsertRoleMember, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await tx.insert(roleMembers).values({ tenantId: p.tenantId, roleRef: p.roleRef, userId: p.userId, reportsTo: p.reportsTo, active: p.active }).onConflictDoUpdate({ target: [roleMembers.tenantId, roleMembers.roleRef, roleMembers.userId], set: { reportsTo: p.reportsTo ?? null, active: p.active } });
      await enqueue(tx, { topic: EVENTS.roleMemberUpserted, eventType: EVENTS.roleMemberUpserted, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { roleRef: p.roleRef, userId: p.userId } });
      await enqueue(tx, { topic: "audit.event.record", eventType: "audit.event.record", tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow", action: "upsert_role_member", resourceType: "role_member", resourceId: p.id, outcome: "success" } });
    });
  });
}
