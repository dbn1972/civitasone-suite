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
import { eq, and } from "drizzle-orm";

const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "role_feature_grant";

function listKey(tenantId: string) { return cache.makeKey(tenantId, RESOURCE, "list"); }

export function registerRoleFeatureConsumers(queue: Queue): void {
  queue.subscribe<{
    id: string; tenantId: string; roleName: string; featureKey: string;
    granted: boolean; grantedBy: string;
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
        version: 1,
      });
      await emit(tx, msg, "policy.role_feature.granted", p, "grant", p.id);
    });
    await cache.invalidate(listKey(msg.payload.tenantId));
  });

  queue.subscribe<{ grantId: string; tenantId: string }>(COMMANDS.roleFeatureRevoke, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await (tx as any).delete(roleFeatureGrants)
        .where(and(eq(roleFeatureGrants.id, p.grantId), eq(roleFeatureGrants.tenantId, p.tenantId)));
      await emit(tx, msg, "policy.role_feature.revoked", p, "revoke", p.grantId);
    });
    await cache.invalidate(listKey(msg.payload.tenantId));
  });
}

async function emit(
  tx: unknown,
  msg: { tenantId: string; actorId: string; correlationId: string },
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId, payload,
  });
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "policy", action, resourceType: RESOURCE, resourceId, outcome: "success" },
  });
}
