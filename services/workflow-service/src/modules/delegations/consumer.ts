import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, CONSUMED_EVENTS } from "../../topics.js";
import { fetchUserRoleKeys } from "../../shared/identity-client.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import * as repo from "./repo.js";
import { resolveDelegationNotice } from "./notice.js";

const log = pino({ name: "workflow-delegations-consumer" });
const AUDIT = "audit.event.record";

export function registerDelegationConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.createDelegation, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; delegatorId: string; delegateId: string;
      fromDate: string; toDate: string | null; reason: string | null; roles?: string[];
    };
    try {
      // Fail-soft hrms lookup (names + delegator's manager) BEFORE the transaction: never holds a DB tx open on HTTP.
      const notice = await resolveDelegationNotice(msg.tenantId, { id: p.id, delegatorId: p.delegatorId,
        delegateId: p.delegateId, roles: p.roles ?? [], fromDate: p.fromDate, toDate: p.toDate });
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.create({ ...p, roles: p.roles ?? [], id: p.id }, tx);
        await enqueue(tx, { topic: EVENTS.delegationCreated, eventType: EVENTS.delegationCreated,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: notice });
        await enqueue(tx, { topic: AUDIT, eventType: AUDIT, tenantId: msg.tenantId, actorId: msg.actorId,
          correlationId: msg.correlationId, payload: { service: "workflow", action: "create",
            resourceType: "delegation", resourceId: p.id, outcome: "success" } });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "createDelegation failed"); throw err; }
  });

  queue.subscribe(COMMANDS.revokeDelegation, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    try {
      const existing = await repo.findById(p.id, p.tenantId);
      const notice = existing ? await resolveDelegationNotice(msg.tenantId, existing) : { id: p.id };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.revoke(p.id, p.tenantId, tx);
        await enqueue(tx, { topic: EVENTS.delegationRevoked, eventType: EVENTS.delegationRevoked,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: notice });
        await enqueue(tx, { topic: AUDIT, eventType: AUDIT, tenantId: msg.tenantId, actorId: msg.actorId,
          correlationId: msg.correlationId, payload: { service: "workflow", action: "revoke",
            resourceType: "delegation", resourceId: p.id, outcome: "success" } });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "revokeDelegation failed"); throw err; }
  });

  // Audit-only: the route refused a revoke by a non-owner; record it durably.
  queue.subscribe(COMMANDS.refuseDelegationRevoke, async (msg) => {
    const p = msg.payload as { id: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await enqueue(tx, { topic: AUDIT, eventType: AUDIT, tenantId: msg.tenantId, actorId: msg.actorId,
          correlationId: msg.correlationId, payload: { service: "workflow", action: "revoke",
            resourceType: "delegation", resourceId: p.id, outcome: "denied", reason: "not_delegator_or_admin" } });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "refuseDelegationRevoke failed"); throw err; }
  });

  registerRoleRevokedConsumer(queue);
}

/**
 * Revoke on role change: when identity-service revokes a role from a user, cancel
 * that user's ACTIVE delegations (as delegator) that convey a role they no longer
 * hold, auditing each. The event carries roleId/userId only (no role key), so the
 * user's current role keys are re-read from identity-service; if that lookup
 * fails nothing is revoked here (the use-time check in the task gate remains the
 * authoritative control and also fails closed).
 */
export function registerRoleRevokedConsumer(rawQueue: Queue): void {
  const q = tenantScoped(rawQueue);
  q.subscribe(CONSUMED_EVENTS.identityRoleRevoked, async (msg) => {
    const p = msg.payload as { userId?: string };
    if (!p.userId) return;
    const held = await fetchUserRoleKeys(msg.tenantId, p.userId);
    if (held === undefined) { log.warn({ userId: p.userId }, "role-revoked: identity lookup failed; relying on use-time check"); return; }
    const stale = (await repo.activeByDelegator(msg.tenantId, p.userId))
      .filter((d) => d.roles.some((r) => !held.includes(r)));
    if (stale.length === 0) return;
    const notices = new Map<string, Record<string, unknown>>();
    for (const d of stale) notices.set(d.id, await resolveDelegationNotice(msg.tenantId, d));
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      for (const d of stale) {
        await repo.revoke(d.id, msg.tenantId, tx);
        await enqueue(tx, { topic: EVENTS.delegationRevoked, eventType: EVENTS.delegationRevoked,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: notices.get(d.id) ?? { id: d.id } });
        await enqueue(tx, { topic: AUDIT, eventType: AUDIT, tenantId: msg.tenantId, actorId: msg.actorId,
          correlationId: msg.correlationId, payload: { service: "workflow", action: "revoke",
            resourceType: "delegation", resourceId: d.id, outcome: "success",
            reason: "delegator_lost_role", lostRoles: d.roles.filter((r) => !held.includes(r)) } });
      }
    });
  });
}
