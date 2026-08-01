/**
 * rates/consumer.ts — handler for the inbound cross-service contract
 * `billing.rate.change_requested` (declared in CONSUMED_EVENTS).
 *
 * Shape follows services/recommendation-service/src/modules/collateral/consumer.ts:
 * the module exports `handleXxx` plus its payload type, and src/worker.ts owns the
 * subscription.
 *
 * What it does: validates the request against the catalogue (does the product
 * exist? does the named rate belong to it? is the lifecycle still open?), records
 * the outcome in catalogue.rate_change_requests, and emits an accepted/rejected
 * event either way so billing can observe the answer instead of waiting on
 * silence. Acceptance does NOT move a price — applying a rate stays behind the
 * governed maker-checker rate endpoints.
 *
 * Defensive by contract: billing-service owns the payload shape, so it is parsed
 * with zod and a malformed message is RECORDED AS REJECTED rather than thrown.
 * Throwing would retry a permanently-bad message until it dead-lettered and,
 * worse, could wedge the consumer behind it.
 */
import { randomUUID } from "node:crypto";
import { pino } from "pino";
import { z } from "zod";
import { runWithTenant } from "@civitasone/db";
import type { CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { CONSUMED_EVENTS, EVENTS, SERVICE } from "../../topics.js";
import * as repo from "./change-request-repo.js";
import type { RateChangeRequestInsert } from "./change-request-schema.js";
import {
  decideRateChange,
  rateChangeRequestedPayloadSchema,
  summariseParseFailure,
  todayIsoDate,
  RATE_CHANGE_REJECTION_CODES,
  type RateChangeDecision,
} from "./change-request-domain.js";

const log = pino({ name: "catalogue-rate-change-consumer" });

const TOPIC = CONSUMED_EVENTS.billingRateChangeRequested;
const AUDIT_TOPIC = "audit.event.record";

/** Re-exported so the worker's `queue.subscribe<T>` and tests share one type. */
export type BillingRateChangeRequestedPayload = z.infer<typeof rateChangeRequestedPayloadSchema>;

/**
 * The only parts of a foreign envelope we must be able to trust. `messageId` has
 * to be a uuid to serve as the inbox dedupe key, and `tenantId`/`actorId` to
 * satisfy RLS and the NOT NULL audit columns.
 */
const envelopeIdsSchema = z.object({
  messageId: z.string().uuid(),
  tenantId: z.string().uuid(),
  actorId: z.string().uuid(),
});

export async function handleBillingRateChangeRequested(msg: CommandEnvelope<unknown>): Promise<void> {
  const startedAt = Date.now();

  const ids = envelopeIdsSchema.safeParse({
    messageId: msg.messageId,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
  });
  if (!ids.success) {
    // Nothing can be written RLS-safely without a tenant, and nothing can be
    // deduplicated without a uuid messageId. Drop it: retrying a structurally
    // impossible envelope would only wedge the consumer.
    log.warn(
      { topic: TOPIC, outcome: "skipped", reason: "unusable_envelope" },
      "dropping rate change request with an unusable envelope",
    );
    return;
  }
  const { messageId, tenantId, actorId } = ids.data;

  // Outbox rows require a non-empty correlationId; a foreign publisher may omit it.
  const correlationId =
    typeof msg.correlationId === "string" && msg.correlationId.length > 0 ? msg.correlationId : messageId;

  // Parsed outside the transaction — pure, and its result decides nothing until
  // the idempotency gate has been passed.
  const parsed = rateChangeRequestedPayloadSchema.safeParse(msg.payload);

  const recordId = randomUUID();
  let recorded: { productId: string | null; decision: RateChangeDecision } | null = null;

  // ── RLS tenant context ──────────────────────────────────────────────────────
  // A consumer runs outside an HTTP request, so nothing has populated the
  // `app.tenant_id` GUC that catalogue's FORCEd row-level security policies read.
  // `db` is wrapped by wrapWithTenantGuc(), which sets the GUC per transaction from
  // AsyncLocalStorage — but only if a tenant context is active. Without this
  // runWithTenant() the SELECTs below would return zero rows and the INSERT would
  // be refused by the policy: the handler would look like it worked and write
  // nothing. Scoped here rather than left to the worker so the handler is correct
  // however it is subscribed.
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    // ── Idempotency gate. MUST be the first operation in the transaction: a
    // redelivery returns here and the whole handler becomes a no-op.
    const fresh = await markProcessed(tx, messageId);
    if (!fresh) return;

    let row: RateChangeRequestInsert;
    let decision: RateChangeDecision;
    let productId: string | null = null;

    if (!parsed.success) {
      decision = {
        outcome: "rejected",
        code: RATE_CHANGE_REJECTION_CODES.malformedPayload,
        reason: summariseParseFailure(parsed.error),
      };
      row = {
        id: recordId,
        tenantId,
        sourceMessageId: messageId,
        outcome: "rejected",
        rejectionCode: decision.code,
        rejectionReason: decision.reason,
        createdBy: actorId,
        updatedBy: actorId,
      };
    } else {
      const p = parsed.data;
      productId = p.productId;

      // All three reads share this transaction, so validation and the recorded
      // outcome see one consistent snapshot.
      const product = await repo.findProductForChange(tx, p.productId, tenantId);
      const lifecycleState = product === null ? null : await repo.findCurrentLifecycleState(tx, p.productId, tenantId);
      const rateResolved =
        product !== null && p.rateId !== undefined
          ? await repo.rateBelongsToProduct(tx, p.rateId, p.productId, tenantId)
          : null;

      decision = decideRateChange({
        productExists: product !== null,
        productStatus: product?.lifecycleStatus ?? null,
        lifecycleState,
        rateResolved,
        // MONEY: BigInt() of the wire string — exact, and never via Number().
        requestedRateMinor: BigInt(p.requestedRateMinor),
        effectiveFrom: p.effectiveFrom ?? null,
        today: todayIsoDate(),
      });

      row = {
        id: recordId,
        tenantId,
        sourceMessageId: messageId,
        requestId: p.requestId,
        productId: p.productId,
        rateId: p.rateId ?? null,
        // MONEY: the wire value is a decimal string; BigInt() keeps it exact.
        requestedRateMinor: BigInt(p.requestedRateMinor),
        currency: p.currency ?? null,
        effectiveFrom: p.effectiveFrom ?? null,
        requestReason: p.reason ?? null,
        outcome: decision.outcome,
        rejectionCode: decision.outcome === "rejected" ? decision.code : null,
        rejectionReason: decision.outcome === "rejected" ? decision.reason : null,
        createdBy: actorId,
        updatedBy: actorId,
      };
    }

    await repo.insertRateChangeRequest(tx, row);

    const outcomeTopic =
      decision.outcome === "accepted" ? EVENTS.rateChangeRequestAccepted : EVENTS.rateChangeRequestRejected;

    await enqueue(tx, {
      topic: outcomeTopic,
      eventType: outcomeTopic,
      tenantId,
      actorId,
      correlationId,
      payload: {
        recordId,
        requestId: row.requestId ?? null,
        productId: row.productId ?? null,
        rateId: row.rateId ?? null,
        // MONEY: serialised as a STRING so no consumer can parse it as a double.
        requestedRateMinor: row.requestedRateMinor === undefined || row.requestedRateMinor === null
          ? null
          : row.requestedRateMinor.toString(),
        currency: row.currency ?? null,
        effectiveFrom: row.effectiveFrom ?? null,
        outcome: decision.outcome,
        ...(decision.outcome === "rejected"
          ? { rejectionCode: decision.code, rejectionReason: decision.reason }
          : {}),
      },
    });

    // Every mutation is audited, including a rejection — the refusal itself is the
    // decision a reviewer needs to see.
    await enqueue(tx, {
      topic: AUDIT_TOPIC,
      eventType: AUDIT_TOPIC,
      tenantId,
      actorId,
      correlationId,
      payload: {
        service: SERVICE,
        action: "rate_change_request_recorded",
        resourceType: "rate_change_request",
        resourceId: recordId,
        outcome: decision.outcome,
        ...(decision.outcome === "rejected" ? { rejectionCode: decision.code } : {}),
        sourceTopic: TOPIC,
        sourceMessageId: messageId,
      },
    });

    recorded = { productId, decision };
  }));

  if (recorded === null) {
    log.info(
      { messageId, topic: TOPIC, tenantId, processingTimeMs: Date.now() - startedAt, outcome: "skipped" },
      "rate change request already processed",
    );
    return;
  }

  // Cache invalidation lives outside the transaction on purpose; a missed
  // invalidation self-heals via the bounded TTL, whereas a Redis stall inside the
  // transaction would hold a database lock open.
  const { productId, decision } = recorded as { productId: string | null; decision: RateChangeDecision };
  try {
    await cache.invalidate(cache.makeKey(tenantId, "rate_change_requests", productId ?? recordId));
  } catch (err) {
    log.warn({ err, messageId, topic: TOPIC, tenantId }, "cache invalidation failed after commit");
  }

  log.info(
    {
      messageId,
      topic: TOPIC,
      tenantId,
      productId,
      recordId,
      processingTimeMs: Date.now() - startedAt,
      outcome: decision.outcome,
      ...(decision.outcome === "rejected" ? { rejectionCode: decision.code } : {}),
    },
    "rate change request validated",
  );
}
