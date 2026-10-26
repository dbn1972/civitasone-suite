/**
 * Subscriptions consumer — the ONLY code that writes Postgres for subscriptions.
 * idempotency-check → apply write + outbox → refresh cache.
 */
import { NonRetryableError, type Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import type { SubscriptionView } from "./repo.js";
import { and, eq } from "drizzle-orm";
import { downgradeRequests, type UsageCheck } from "./schema.js";
import * as plansRepo from "../plans/repo.js";
import * as quotasRepo from "../quotas/repo.js";
import { exceededLimits } from "./downgrade.js";

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
    // Deterministic business rejection: retrying can never succeed, so dead-letter immediately (outcome "rejected").
    throw new NonRetryableError(`INVALID_SUBSCRIPTION_TRANSITION: ${current} → ${target} is not allowed`);
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
          throw new NonRetryableError(`INVALID_SUBSCRIPTION_STATE: subscription ${cur.status} cannot renew`);
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

  // OWNER DECISION #24: record a downgrade REQUEST. markProcessed + the guarded
  // insert + the audit event share ONE transaction. The partial unique index
  // (one pending request per tenant) makes a racing second request a no-op
  // instead of a second pending row.
  queue.subscribe<{ id: string; subscriptionId: string; fromPlanId: string; targetPlanId: string; reason: string; usage: { checks: UsageCheck[] } }>(
    COMMANDS.subscriptionDowngradeRequest,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        const existing = await tx.select({ id: downgradeRequests.id }).from(downgradeRequests)
          .where(and(eq(downgradeRequests.tenantId, msg.tenantId), eq(downgradeRequests.status, "pending"))).limit(1);
        if (existing[0]) throw new NonRetryableError("REQUEST_ALREADY_PENDING: a downgrade request is already awaiting approval");
        await tx.insert(downgradeRequests).values({
          id: p.id, tenantId: msg.tenantId, subscriptionId: p.subscriptionId, fromPlanId: p.fromPlanId, targetPlanId: p.targetPlanId,
          reason: p.reason, usageSnapshot: p.usage, status: "pending", requestedBy: msg.actorId,
        });
        await emit(tx, msg, EVENTS.subscriptionDowngradeRequested, {
          requestId: p.id, subscriptionId: p.subscriptionId, fromPlanId: p.fromPlanId, targetPlanId: p.targetPlanId,
        }, "downgrade_request", p.id, { reason: p.reason });
      });
    },
  );

  // OWNER DECISION #24: platform billing approves or rejects. Approver != requester
  // is re-enforced HERE (the consumer is the only writer). An approval re-checks the
  // live usage against the target plan: if usage grew past the limit since the request
  // was made it is rejected (never applied) and says why. All of it, plus the audit
  // event, in ONE transaction with the request row locked.
  queue.subscribe<{ id: string; decision: "approve" | "reject"; reason: string | null }>(
    COMMANDS.subscriptionDowngradeDecision,
    async (msg) => {
      const p = msg.payload;
      // Reads of other modules' tables happen BEFORE the write transaction (L2, and
      // no nested transaction): the request, its target plan and the live usage.
      const preview = await repo.findDowngradeRequest(msg.tenantId, p.id);
      const targetPlan = preview ? await plansRepo.findByIdScoped(msg.tenantId, preview.targetPlanId) : null;
      const quotas = await quotasRepo.findAllByTenantScoped(msg.tenantId);
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await tx.select().from(downgradeRequests)
          .where(and(eq(downgradeRequests.id, p.id), eq(downgradeRequests.tenantId, msg.tenantId))).limit(1).for("update");
        const req = rows[0];
        if (!req) throw new NonRetryableError("NOT_FOUND: downgrade request not found");
        if (req.status !== "pending") throw new NonRetryableError(`ALREADY_DECIDED: request is ${req.status}`);
        if (req.requestedBy === msg.actorId) throw new NonRetryableError("SELF_APPROVAL: the requester cannot decide their own downgrade");

        let outcome: "approved" | "rejected" = p.decision === "approve" ? "approved" : "rejected";
        let decisionReason = p.reason;
        if (outcome === "approved") {
          const target = targetPlan && targetPlan.id === req.targetPlanId ? targetPlan : null;
          const sub = await repo.findByIdTx(tx as unknown as repo.Writer, req.subscriptionId);
          const used = (r: string) => quotas.find((q) => q.resource === r)?.used ?? 0;
          const over = target ? exceededLimits({ users: used("users"), storage_gb: used("storage_gb") }, target) : [];
          // The subscription must still be on the plan the request was made from; otherwise the request is stale.
          if (!target || !sub || sub.planId !== req.fromPlanId || over.length > 0) {
            outcome = "rejected";
            decisionReason = over.length > 0 ? "USAGE_EXCEEDS_TARGET_PLAN" : "PLAN_OR_SUBSCRIPTION_CHANGED";
          } else {
            await repo.update(tx as unknown as repo.Writer, sub.id, { planId: req.targetPlanId, updatedBy: msg.actorId, version: sub.version + 1 });
          }
        }
        await tx.update(downgradeRequests).set({
          status: outcome, decidedBy: msg.actorId, decidedAt: new Date(), decisionReason: decisionReason ?? null, updatedAt: new Date(), version: req.version + 1,
        }).where(and(eq(downgradeRequests.id, p.id), eq(downgradeRequests.tenantId, msg.tenantId)));
        if (outcome === "approved") {
          await emit(tx, msg, EVENTS.subscriptionDowngraded, { subscriptionId: req.subscriptionId, oldPlanId: req.fromPlanId, newPlanId: req.targetPlanId, requestId: p.id }, "downgrade_approve", p.id, { reason: decisionReason ?? null });
        } else {
          await emit(tx, msg, EVENTS.subscriptionDowngradeRejected, { subscriptionId: req.subscriptionId, requestId: p.id }, "downgrade_reject", p.id, { reason: decisionReason ?? null });
        }
      });
      const sub = await repo.findByTenantIdScoped(msg.tenantId);
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
  auditExtra: Record<string, unknown> = {},
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId, payload,
  });
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "tenant", action, resourceType: "subscription", resourceId, outcome: "success", ...auditExtra },
  });
}
