/**
 * inspection-service: Enforcement module — command consumers.
 *
 * Each handler follows the CivitasOne CQRS consumer contract:
 *   1. markProcessed(tx, msg.messageId) — idempotency guard
 *   2. Business write inside the same transaction
 *   3. Outbox: domain event + audit event (same transaction — atomicity)
 *   4. Cache invalidation (outside transaction — best-effort)
 *
 * _Requirements: SVC-107_
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import {
  assertValidPenaltyOrderTransition,
  assertMakerChecker,
  validateAmount,
  DomainError,
} from "./domain.js";
import {
  insertPenaltyRate,
  insertShowCauseNotice,
  updateShowCauseNotice,
  insertPenaltyOrder,
  updatePenaltyOrder,
  insertProsecutionReferral,
  findShowCauseById,
  findPenaltyOrderById,
} from "./repo.js";
import type {
  PenaltyRateCreatePayload,
  ShowCauseCreatePayload,
  ShowCauseRespondPayload,
  PenaltyOrderCreatePayload,
  PenaltyOrderIssuePayload,
  ProsecutionReferPayload,
} from "./commands.js";

const log = pino({ name: "enforcement-consumer" });

const AUDIT_TOPIC = "audit.event.record";

// ── Registration ─────────────────────────────────────────────────────────────

export function registerEnforcementConsumers(queue: Queue): void {
  // ─── penaltyRateCreate ────────────────────────────────────────────────────
  queue.subscribe<PenaltyRateCreatePayload & { tenantId: string }>(
    COMMANDS.penaltyRateCreate,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const amountBigint = BigInt(p.amount);
        try { validateAmount(amountBigint); } catch (err) {
          if (err instanceof DomainError) throw new NonRetryableError(err.message);
          throw err;
        }

        const rate = await insertPenaltyRate(tx, {
          tenantId: msg.tenantId,
          provisionId: p.provisionId,
          effectiveFrom: p.effectiveFrom,
          effectiveTo: p.effectiveTo ?? null,
          amount: amountBigint,
          currency: p.currency ?? "INR",
          description: p.description ?? null,
          isActive: true,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "penalty_rate.created",
            resourceType: "penalty_rate",
            resourceId: rate.id,
            details: { provisionId: p.provisionId, amount: p.amount },
          },
        });
      });
    },
  );

  // ─── showCauseCreate ──────────────────────────────────────────────────────
  queue.subscribe<ShowCauseCreatePayload & { tenantId: string }>(
    COMMANDS.showCauseCreate,
    async (msg) => {
      const p = msg.payload;
      let noticeId: string | undefined;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const notice = await insertShowCauseNotice(tx, {
          tenantId: msg.tenantId,
          findingId: p.findingId,
          entityId: p.entityId,
          issuedTo: p.issuedTo,
          responseDeadline: p.responseDeadline,
          status: "issued",
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });

        noticeId = notice.id;

        await enqueue(tx, {
          topic: EVENTS.showCauseIssued,
          eventType: EVENTS.showCauseIssued,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            showCauseId: notice.id,
            findingId: p.findingId,
            entityId: p.entityId,
            issuedTo: p.issuedTo,
          },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "show_cause.issued",
            resourceType: "show_cause_notice",
            resourceId: notice.id,
            details: { findingId: p.findingId, entityId: p.entityId },
          },
        });
      });

      if (noticeId) {
        try { await cache.invalidate(cache.makeKey(msg.tenantId, "show_cause", noticeId)); }
        catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
      }
    },
  );

  // ─── showCauseRespond ─────────────────────────────────────────────────────
  queue.subscribe<ShowCauseRespondPayload & { tenantId: string }>(
    COMMANDS.showCauseRespond,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const notice = await findShowCauseById(msg.tenantId, p.showCauseId);
        if (!notice) {
          throw new NonRetryableError(`Show cause notice not found: ${p.showCauseId}`);
        }

        await updateShowCauseNotice(tx, p.showCauseId, msg.tenantId, {
          responseReceived: true,
          responseText: p.responseText,
          status: "response_received",
          updatedBy: msg.actorId,
        }, notice.version);

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "show_cause.response_received",
            resourceType: "show_cause_notice",
            resourceId: p.showCauseId,
            details: {},
          },
        });
      });

      try { await cache.invalidate(cache.makeKey(msg.tenantId, "show_cause", p.showCauseId)); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );

  // ─── penaltyOrderCreate ───────────────────────────────────────────────────
  queue.subscribe<PenaltyOrderCreatePayload & { tenantId: string }>(
    COMMANDS.penaltyOrderCreate,
    async (msg) => {
      const p = msg.payload;
      let orderId: string | undefined;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const amountBigint = BigInt(p.amount);
        try { validateAmount(amountBigint); } catch (err) {
          if (err instanceof DomainError) throw new NonRetryableError(err.message);
          throw err;
        }

        const order = await insertPenaltyOrder(tx, {
          tenantId: msg.tenantId,
          findingId: p.findingId,
          entityId: p.entityId,
          showCauseId: p.showCauseId ?? null,
          penaltyRateId: p.penaltyRateId ?? null,
          amount: amountBigint,
          currency: p.currency ?? "INR",
          status: "draft",
          makerUserId: msg.actorId,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });

        orderId = order.id;

        await enqueue(tx, {
          topic: EVENTS.penaltyOrderCreated,
          eventType: EVENTS.penaltyOrderCreated,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            penaltyOrderId: order.id,
            findingId: p.findingId,
            entityId: p.entityId,
            amount: p.amount,
          },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "penalty_order.created",
            resourceType: "penalty_order",
            resourceId: order.id,
            details: { findingId: p.findingId, amount: p.amount },
          },
        });
      });

      if (orderId) {
        try { await cache.invalidate(cache.makeKey(msg.tenantId, "penalty_order", orderId)); }
        catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
      }
    },
  );

  // ─── penaltyOrderIssue ────────────────────────────────────────────────────
  queue.subscribe<PenaltyOrderIssuePayload & { tenantId: string }>(
    COMMANDS.penaltyOrderIssue,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const order = await findPenaltyOrderById(msg.tenantId, p.penaltyOrderId);
        if (!order) {
          throw new NonRetryableError(`Penalty order not found: ${p.penaltyOrderId}`);
        }

        // State transition check
        try {
          assertValidPenaltyOrderTransition(order.status as "draft", "issued");
        } catch (err) {
          if (err instanceof DomainError) throw new NonRetryableError(err.message);
          throw err;
        }

        // Maker-checker enforcement: issuer ≠ creator
        try {
          assertMakerChecker(order.makerUserId, msg.actorId);
        } catch (err) {
          if (err instanceof DomainError) throw new NonRetryableError(err.message);
          throw err;
        }

        await updatePenaltyOrder(tx, p.penaltyOrderId, msg.tenantId, {
          status: "issued",
          issuedBy: msg.actorId,
          issuedAt: new Date(),
          checkerUserId: msg.actorId,
          updatedBy: msg.actorId,
        }, order.version);

        await enqueue(tx, {
          topic: EVENTS.penaltyOrderIssued,
          eventType: EVENTS.penaltyOrderIssued,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            penaltyOrderId: p.penaltyOrderId,
            issuedBy: msg.actorId,
            amount: order.amount.toString(),
          },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "penalty_order.issued",
            resourceType: "penalty_order",
            resourceId: p.penaltyOrderId,
            details: { makerUserId: order.makerUserId, checkerUserId: msg.actorId },
          },
        });
      });

      try { await cache.invalidate(cache.makeKey(msg.tenantId, "penalty_order", p.penaltyOrderId)); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );

  // ─── prosecutionRefer ─────────────────────────────────────────────────────
  queue.subscribe<ProsecutionReferPayload & { tenantId: string }>(
    COMMANDS.prosecutionRefer,
    async (msg) => {
      const p = msg.payload;
      let referralId: string | undefined;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const order = await findPenaltyOrderById(msg.tenantId, p.penaltyOrderId);
        if (!order) {
          throw new NonRetryableError(`Penalty order not found: ${p.penaltyOrderId}`);
        }

        const referral = await insertProsecutionReferral(tx, {
          tenantId: msg.tenantId,
          penaltyOrderId: p.penaltyOrderId,
          findingId: order.findingId,
          entityId: order.entityId,
          referredBy: msg.actorId,
          status: "pending",
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });

        referralId = referral.id;

        await enqueue(tx, {
          topic: EVENTS.prosecutionReferred,
          eventType: EVENTS.prosecutionReferred,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            referralId: referral.id,
            penaltyOrderId: p.penaltyOrderId,
            entityId: order.entityId,
          },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "prosecution.referred",
            resourceType: "prosecution_referral",
            resourceId: referral.id,
            details: { penaltyOrderId: p.penaltyOrderId },
          },
        });
      });

      if (referralId) {
        try { await cache.invalidate(cache.makeKey(msg.tenantId, "prosecution_referral", referralId)); }
        catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
      }
    },
  );
}
