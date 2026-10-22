/**
 * Role Features consumer — the ONLY code that writes Postgres for role feature grants.
 * idempotency-check → apply write + outbox → refresh cache.
 */
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { roleFeatureGrants } from "./schema.js";
import { eq, and, isNull } from "drizzle-orm";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "role_feature_grant";

function listKey(tenantId: string) { return cache.makeKey(tenantId, RESOURCE, "list"); }

export function registerRoleFeatureConsumers(queue: Queue): void {
  // RLS (#146): every handler must run inside the message's tenant context.
  queue = tenantScoped(queue);
  queue.subscribe<{
    id: string; tenantId: string; roleName: string; featureKey: string;
    granted: boolean; grantedBy: string; reason?: string | null;
  }>(COMMANDS.roleFeatureGrant, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await (tx as any).insert(roleFeatureGrants).values({
        id: p.id,
        tenantId: p.tenantId,
        roleName: p.roleName,
        featureKey: p.featureKey,
        granted: p.granted,
        grantedBy: p.grantedBy,
        reason: p.reason ?? null,
        version: 1,
      });
      await emit(tx, msg, "policy.role_feature.granted", p, "grant", p.id, "success", p.reason ?? null);
    });
    await cache.invalidate(listKey(msg.payload.tenantId));
  });

  queue.subscribe<{ grantId: string; tenantId: string; reason?: string | null }>(COMMANDS.roleFeatureRevoke, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      // Soft revoke: keep the row as history (who/when/why) instead of hard-deleting it.
      const updated = await (tx as any).update(roleFeatureGrants)
        .set({ revokedAt: new Date(), revokedBy: msg.actorId, revokeReason: p.reason ?? null, updatedAt: new Date() })
        .where(and(eq(roleFeatureGrants.id, p.grantId), eq(roleFeatureGrants.tenantId, p.tenantId), isNull(roleFeatureGrants.revokedAt)))
        .returning({ id: roleFeatureGrants.id });
      if (updated.length === 0) {
        // Unknown or already-revoked grant: audit the refusal, emit no revoked event.
        await audit(tx, msg, "revoke", p.grantId, "failure", p.reason ?? null, "UNKNOWN_OR_ALREADY_REVOKED_GRANT");
        return;
      }
      await emit(tx, msg, "policy.role_feature.revoked", p, "revoke", p.grantId, "success", p.reason ?? null);
    });
    await cache.invalidate(listKey(msg.payload.tenantId));
  });
}

async function audit(
  tx: unknown,
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceId: string,
  outcome: "success" | "failure",
  reason: string | null,
  code?: string,
): Promise<void> {
  await enqueue(tx as Parameters<typeof enqueue>[0], {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "policy", action, resourceType: RESOURCE, resourceId, outcome, ...(reason ? { reason } : {}), ...(code ? { code } : {}) },
  });
}

async function emit(
  tx: unknown,
  msg: { tenantId: string; actorId: string; correlationId: string },
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string,
  outcome: "success",
  reason: string | null,
): Promise<void> {
  await enqueue(tx as Parameters<typeof enqueue>[0], {
    topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId, payload,
  });
  await audit(tx, msg, action, resourceId, outcome, reason);
}
