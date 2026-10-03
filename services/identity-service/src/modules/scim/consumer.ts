import type { Queue } from "@civitasone/queue";
import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { users } from "../users/schema.js";
import * as operatorsRepo from "../operators/repo.js";

const AUDIT = "audit.event.record";

// Real bug fix: createdBy/updatedBy here used to be the literal string "scim"
// instead of msg.actorId. users.created_by/updated_by and
// _outbox.messages.actor_id are `uuid NOT NULL` columns, so every SCIM
// create/replace/patch/delete has always failed inside this transaction with
// `invalid input syntax for type uuid: "scim"` — silently since the F3 async
// conversion moved the write off the request path (see scim/commands.ts,
// which now publishes a real UUID system-actor sentinel as actorId instead
// of that same literal).

export function registerScimConsumers(q: Queue): void {
  q.subscribe<{ id: string; tenantId: string; email: string; name: string; status: string }>(
    COMMANDS.scimUserCreate,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await tx.insert(users).values({
          id: p.id,
          tenantId: p.tenantId,
          email: p.email,
          name: p.name,
          status: p.status,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: EVENTS.userCreated,
          eventType: EVENTS.userCreated,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { userId: p.id },
        });
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: AUDIT,
          eventType: AUDIT,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "identity",
            action: "scim_user_create",
            resourceType: "user",
            resourceId: p.id,
            outcome: "success",
          },
        });
      });
    },
  );

  q.subscribe<{ id: string; tenantId: string; patch: Record<string, unknown> }>(
    COMMANDS.scimUserReplace,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        const patch = await withoutOperatorStatus(tx, msg, p.id, p.patch);
        await tx
          .update(users)
          .set({ ...patch, updatedBy: msg.actorId, updatedAt: new Date() })
          .where(and(eq(users.id, p.id), eq(users.tenantId, p.tenantId)));
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: EVENTS.userUpdated,
          eventType: EVENTS.userUpdated,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { userId: p.id },
        });
      });
    },
  );

  q.subscribe<{ id: string; tenantId: string; patch: Record<string, unknown> }>(
    COMMANDS.scimUserPatch,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        const patch = await withoutOperatorStatus(tx, msg, p.id, p.patch);
        await tx
          .update(users)
          .set({ ...patch, updatedBy: msg.actorId, updatedAt: new Date() })
          .where(and(eq(users.id, p.id), eq(users.tenantId, p.tenantId)));
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: EVENTS.userUpdated,
          eventType: EVENTS.userUpdated,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { userId: p.id },
        });
      });
    },
  );

  q.subscribe<{ id: string; tenantId: string }>(COMMANDS.scimUserDelete, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      if (await operatorsRepo.loadOperator(tx as never, msg.tenantId, p.id)) {
        await refusedAudit(tx, msg, p.id, "delete");
        return;
      }
      await tx
        .update(users)
        .set({ status: "disabled", updatedBy: msg.actorId, updatedAt: new Date() })
        .where(and(eq(users.id, p.id), eq(users.tenantId, p.tenantId)));
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: EVENTS.userDeactivated,
        eventType: EVENTS.userDeactivated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { userId: p.id, status: "disabled" },
      });
    });
  });
}

/**
 * GAP-ADMIN-OPERATORS-05: apply-time twin of the route check. A SCIM command that would change a platform
 * operator's status has the status dropped (other attributes still apply) and a denied audit event written.
 */
async function withoutOperatorStatus(tx: unknown, msg: { tenantId: string; actorId: string; correlationId: string }, userId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (patch["status"] === undefined) return patch;
  if (!(await operatorsRepo.loadOperator(tx as never, msg.tenantId, userId))) return patch;
  await refusedAudit(tx, msg, userId, "status");
  const rest = { ...patch };
  delete rest["status"];
  return rest;
}

async function refusedAudit(tx: unknown, msg: { tenantId: string; actorId: string; correlationId: string }, userId: string, what: string): Promise<void> {
  await enqueue(tx as Parameters<typeof enqueue>[0], {
    topic: "audit.event.record", eventType: "audit.event.record", tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "identity", action: `scim_${what}_refused`, resourceType: "user", resourceId: userId, outcome: "denied", severity: "high", code: "OPERATOR_REQUIRES_APPROVAL" },
  });
}
