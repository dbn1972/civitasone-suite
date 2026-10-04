import type { Queue } from "@civitasone/queue";
import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { users } from "../users/schema.js";
import * as operatorsRepo from "../operators/repo.js";
import * as keycloak from "../../shared/keycloak.js";
import { recordPendingDeactivation, deprovisionInKeycloak } from "../../shared/kc-reconcile.js";
import { pino } from "pino";
import { strandsTenantAdmins } from "../users/last-admin.js";
import * as usersRepo from "../users/repo.js";
import type * as rbacRepo from "../rbac/repo.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { SCIM_INACTIVE_STATUS } from "../users/domain.js";

const AUDIT = "audit.event.record";

// Real bug fix: createdBy/updatedBy here used to be the literal string "scim"
// instead of msg.actorId. users.created_by/updated_by and
// _outbox.messages.actor_id are `uuid NOT NULL` columns, so every SCIM
// create/replace/patch/delete has always failed inside this transaction with
// `invalid input syntax for type uuid: "scim"` — silently since the F3 async
// conversion moved the write off the request path (see scim/commands.ts,
// which now publishes a real UUID system-actor sentinel as actorId instead
// of that same literal).

const kcLog = pino({ name: "identity-scim-keycloak" });

export function registerScimConsumers(rawQueue: Queue): void {
  // Tenant-scoped like the users consumers, so the post-commit Keycloak outcome write (outside the transaction) runs under RLS context.
  const q = tenantScoped(rawQueue);
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
      let kcEmail: string | null = null;
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        const guarded = await guardScimStatus(tx, msg, p.id, await withoutOperatorStatus(tx, msg, p.id, p.patch));
        const patch = guarded.patch;
        kcEmail = guarded.deactivateEmail;
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
      if (kcEmail) await deprovisionInKeycloak(msg.tenantId, msg.payload.id, kcEmail, kcLog);
    },
  );

  q.subscribe<{ id: string; tenantId: string; patch: Record<string, unknown> }>(
    COMMANDS.scimUserPatch,
    async (msg) => {
      let kcEmail: string | null = null;
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        const guarded = await guardScimStatus(tx, msg, p.id, await withoutOperatorStatus(tx, msg, p.id, p.patch));
        const patch = guarded.patch;
        kcEmail = guarded.deactivateEmail;
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
      if (kcEmail) await deprovisionInKeycloak(msg.tenantId, msg.payload.id, kcEmail, kcLog);
    },
  );

  q.subscribe<{ id: string; tenantId: string }>(COMMANDS.scimUserDelete, async (msg) => {
    let kcEmail: string | null = null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      if (await operatorsRepo.loadOperator(tx as never, msg.tenantId, p.id)) {
        await refusedAudit(tx, msg, p.id, "delete");
        return;
      }
      const guarded = await guardScimStatus(tx, msg, p.id, { status: SCIM_INACTIVE_STATUS });
      if (guarded.patch["status"] === undefined) return; // already deactivated (or no such user): idempotent no-op
      kcEmail = guarded.deactivateEmail;
      await tx
        .update(users)
        .set({ status: SCIM_INACTIVE_STATUS, updatedBy: msg.actorId, updatedAt: new Date() })
        .where(and(eq(users.id, p.id), eq(users.tenantId, p.tenantId)));
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: EVENTS.userDeactivated,
        eventType: EVENTS.userDeactivated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { userId: p.id, status: SCIM_INACTIVE_STATUS },
      });
    });
    if (kcEmail) await deprovisionInKeycloak(msg.tenantId, msg.payload.id, kcEmail, kcLog);
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

/**
 * users.status is a state machine in which deactivated is terminal (users/domain.ts ALLOWED). A SCIM status change
 * therefore (a) is dropped when it would not change anything, (b) is REFUSED, with a denied audit event, when the user is
 * already deactivated, and (c) when it deactivates, records the durable Keycloak reconciliation obligation in the same
 * transaction. Returns the email to deprovision in Keycloak after commit, if any.
 */
async function guardScimStatus(tx: unknown, msg: { tenantId: string; actorId: string; correlationId: string }, userId: string, patch: Record<string, unknown>): Promise<{ patch: Record<string, unknown>; deactivateEmail: string | null }> {
  const next = patch["status"];
  if (next === undefined) return { patch, deactivateEmail: null };
  const [cur] = await (tx as typeof db).select({ status: users.status, email: users.email }).from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, msg.tenantId))).limit(1);
  const rest = { ...patch };
  delete rest["status"];
  if (!cur || cur.status === next) return { patch: rest, deactivateEmail: null };
  if (cur.status === "deactivated") {
    await enqueue(tx as Parameters<typeof enqueue>[0], {
      topic: "audit.event.record", eventType: "audit.event.record", tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
      payload: { service: "identity", action: "scim_status_refused", resourceType: "user", resourceId: userId, outcome: "denied", severity: "high", code: "USER_DEACTIVATED", status: next },
    });
    return { patch: rest, deactivateEmail: null };
  }
  if (next !== SCIM_INACTIVE_STATUS) return { patch, deactivateEmail: null };
  // GAP-ADMIN-USERS-01 (#1839): same race-safe guard as the status route -- serialise the tenant's admin changes under the
  // shared advisory lock, then re-check against current state. A refused change is not applied and is audited.
  if (cur.status === "active") {
    await usersRepo.lockTenantAdmins(tx as usersRepo.Writer, msg.tenantId);
    if (await strandsTenantAdmins(tx as rbacRepo.Writer, msg.tenantId, userId)) {
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: "audit.event.record", eventType: "audit.event.record", tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "identity", action: "status_change", resourceType: "user", resourceId: userId, outcome: "denied", reason: "LAST_TENANT_ADMIN", severity: "high" },
      });
      return { patch: rest, deactivateEmail: null };
    }
  }
  let deactivateEmail: string | null = null;
  if (keycloak.isKeycloakEnabled()) {
    deactivateEmail = cur.email;
    await recordPendingDeactivation(tx as { insert: typeof db.insert }, {
      tenantId: msg.tenantId, userId, email: cur.email, correlationId: msg.correlationId, lastError: "pending initial keycloak deactivate",
    });
  }
  return { patch, deactivateEmail };
}
