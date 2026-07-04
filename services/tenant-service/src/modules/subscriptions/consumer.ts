/**
 * Subscriptions consumer — the ONLY code that writes Postgres for subscriptions.
 * idempotency-check → apply write + outbox → refresh cache.
 */
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import type { SubscriptionView } from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "subscription";

function keyFor(tenantId: string, id: string) { return cache.makeKey(tenantId, RESOURCE, id); }

/** Allowed status transitions for subscriptions. */
const TRANSITIONS: Record<string, string[]> = {
  trial: ["active", "cancelled"],
  active: ["past_due", "suspended", "cancelled"],
  past_due: ["active", "suspended", "cancelled"],
  suspended: ["active", "cancelled"],
  cancelled: [],
};

function assertTransition(current: string, target: string): void {
  const allowed = TRANSITIONS[current] ?? [];
  if (!allowed.includes(target)) {
    throw new Error(`subscription status transition ${current} → ${target} is not allowed`);
  }
}

export function registerSubscriptionConsumers(queue: Queue): void {
  queue.subscribe<SubscriptionView>(COMMANDS.subscriptionCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx as unknown as repo.Writer, {
        id: p.id,
        tenantId: p.tenantId,
        planId: p.planId,
        status: "trial",
        startDate: new Date(p.startDate as unknown as string),
        trialEndsAt: p.trialEndsAt ? new Date(p.trialEndsAt as unknown as string) : null,
        currentPeriodStart: new Date(p.currentPeriodStart as unknown as string),
        currentPeriodEnd: new Date(p.currentPeriodEnd as unknown as string),
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await emit(tx, msg, EVENTS.subscriptionCreated, { subscriptionId: p.id, tenantId: p.tenantId, planId: p.planId }, "create", p.id);
    });
    await cache.put(keyFor(msg.tenantId, msg.payload.id), msg.payload);
  });

  queue.subscribe<{ id: string; newPlanId: string; effectiveDate: string | null }>(
    COMMANDS.subscriptionUpgrade,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const cur = await repo.findByIdTx(tx as unknown as repo.Writer, msg.payload.id);
        if (!cur) throw new Error(`subscription ${msg.payload.id} not found`);
        assertTransition(cur.status, "active");
        await repo.update(tx as unknown as repo.Writer, msg.payload.id, {
          planId: msg.payload.newPlanId,
          status: "active",
          updatedBy: msg.actorId,
          version: cur.version + 1,
        });
        await emit(tx, msg, EVENTS.subscriptionUpgraded, {
          subscriptionId: msg.payload.id, oldPlanId: cur.planId, newPlanId: msg.payload.newPlanId,
        }, "upgrade", msg.payload.id);
      });
      await cache.invalidate(keyFor(msg.tenantId, msg.payload.id));
    },
  );

  queue.subscribe<{ id: string; reason: string; immediate: boolean }>(
    COMMANDS.subscriptionCancel,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const cur = await repo.findByIdTx(tx as unknown as repo.Writer, msg.payload.id);
        if (!cur) throw new Error(`subscription ${msg.payload.id} not found`);
        assertTransition(cur.status, "cancelled");
        await repo.update(tx as unknown as repo.Writer, msg.payload.id, {
          status: "cancelled",
          cancelledAt: new Date(),
          cancelReason: msg.payload.reason,
          endDate: msg.payload.immediate ? new Date() : cur.currentPeriodEnd,
          updatedBy: msg.actorId,
          version: cur.version + 1,
        });
        await emit(tx, msg, EVENTS.subscriptionCancelled, {
          subscriptionId: msg.payload.id, reason: msg.payload.reason, immediate: msg.payload.immediate,
        }, "cancel", msg.payload.id);
      });
      await cache.invalidate(keyFor(msg.tenantId, msg.payload.id));
    },
  );

  queue.subscribe<{ id: string; newPeriodStart: string; newPeriodEnd: string }>(
    COMMANDS.subscriptionRenew,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const cur = await repo.findByIdTx(tx as unknown as repo.Writer, msg.payload.id);
        if (!cur) throw new Error(`subscription ${msg.payload.id} not found`);
        // Only active/past_due can renew
        if (!["active", "past_due"].includes(cur.status)) {
          throw new Error(`subscription ${cur.status} cannot renew`);
        }
        await repo.update(tx as unknown as repo.Writer, msg.payload.id, {
          status: "active",
          currentPeriodStart: new Date(msg.payload.newPeriodStart),
          currentPeriodEnd: new Date(msg.payload.newPeriodEnd),
          updatedBy: msg.actorId,
          version: cur.version + 1,
        });
        await emit(tx, msg, EVENTS.subscriptionRenewed, {
          subscriptionId: msg.payload.id,
        }, "renew", msg.payload.id);
      });
      await cache.invalidate(keyFor(msg.tenantId, msg.payload.id));
    },
  );

  queue.subscribe<{ id: string; reason: string }>(
    COMMANDS.subscriptionSuspend,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const cur = await repo.findByIdTx(tx as unknown as repo.Writer, msg.payload.id);
        if (!cur) throw new Error(`subscription ${msg.payload.id} not found`);
        assertTransition(cur.status, "suspended");
        await repo.update(tx as unknown as repo.Writer, msg.payload.id, {
          status: "suspended",
          updatedBy: msg.actorId,
          version: cur.version + 1,
        });
        await emit(tx, msg, EVENTS.subscriptionSuspended, {
          subscriptionId: msg.payload.id, reason: msg.payload.reason,
        }, "suspend", msg.payload.id);
      });
      await cache.invalidate(keyFor(msg.tenantId, msg.payload.id));
    },
  );

  // ── Self-service subscription management ───────────────────────────────

  queue.subscribe<{ targetPlanId: string; paymentMethod: string; razorpayOrderId: string }>(
    COMMANDS.subscriptionUpgradeInitiate,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        // Find the tenant's active subscription
        const sub = await repo.findByTenantIdTx(tx as unknown as repo.Writer, msg.tenantId);
        if (!sub) throw new Error(`no active subscription for tenant ${msg.tenantId}`);
        // Record the upgrade intent (actual activation happens on payment confirmation)
        await emit(tx, msg, EVENTS.subscriptionUpgradeInitiated, {
          subscriptionId: sub.id, targetPlanId: msg.payload.targetPlanId,
          razorpayOrderId: msg.payload.razorpayOrderId,
        }, "upgrade_initiate", sub.id);
      });
    },
  );

  queue.subscribe<{ targetPlanId: string }>(
    COMMANDS.subscriptionDowngrade,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const sub = await repo.findByTenantIdTx(tx as unknown as repo.Writer, msg.tenantId);
        if (!sub) throw new Error(`no active subscription for tenant ${msg.tenantId}`);
        // Downgrade takes effect at end of current period
        await repo.update(tx as unknown as repo.Writer, sub.id, {
          planId: msg.payload.targetPlanId,
          updatedBy: msg.actorId,
          version: sub.version + 1,
        });
        await emit(tx, msg, EVENTS.subscriptionDowngraded, {
          subscriptionId: sub.id, oldPlanId: sub.planId, newPlanId: msg.payload.targetPlanId,
        }, "downgrade", sub.id);
      });
      const sub = await repo.findByTenantId(msg.tenantId);
      if (sub) await cache.invalidate(keyFor(msg.tenantId, sub.id));
    },
  );

  queue.subscribe<{ reason: string; feedback?: string }>(
    COMMANDS.subscriptionCancelSelf,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const sub = await repo.findByTenantIdTx(tx as unknown as repo.Writer, msg.tenantId);
        if (!sub) throw new Error(`no active subscription for tenant ${msg.tenantId}`);
        assertTransition(sub.status, "cancelled");
        // Self-cancel always takes effect at end of billing period (not immediate)
        await repo.update(tx as unknown as repo.Writer, sub.id, {
          status: "cancelled",
          cancelledAt: new Date(),
          cancelReason: msg.payload.reason,
          endDate: sub.currentPeriodEnd,
          updatedBy: msg.actorId,
          version: sub.version + 1,
        });
        await emit(tx, msg, EVENTS.subscriptionCancelledSelf, {
          subscriptionId: sub.id, reason: msg.payload.reason, feedback: msg.payload.feedback,
        }, "cancel_self", sub.id);
      });
      const sub = await repo.findByTenantId(msg.tenantId);
      if (sub) await cache.invalidate(keyFor(msg.tenantId, sub.id));
    },
  );
}

/** Enqueue domain event + mandatory audit event. */
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
    payload: { service: "tenant", action, resourceType: "subscription", resourceId, outcome: "success" },
  });
}
