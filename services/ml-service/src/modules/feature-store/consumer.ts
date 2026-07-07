/**
 * feature-store consumer — Listens to domain entity events for real-time
 * feature vector recomputation within 60 seconds of an entity change.
 *
 * Consumed events:
 *   - crm.lead.created / crm.lead.updated → leads domain
 *   - helpdesk.ticket.created / helpdesk.ticket.updated → tickets domain
 *   - inventory.receipt.posted / inventory.issue.posted → inventory domain
 *   - billing.subscription.updated → subscriptions domain
 *   - project.task.updated → tasks domain
 *   - finance.transaction.posted → transactions domain
 *
 * Each handler:
 *   1. Calls markProcessed for idempotency
 *   2. Triggers computeAndCache for the affected entity
 *   3. Logs processing time to ensure < 60s SLA
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 20.5, 20.6
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { CONSUMED } from "../../topics.js";
import { computeAndCache } from "./domain.js";
import { recordConsumerMessage } from "../observability/metrics.js";
import type { FeatureDomain } from "./schema.js";

const log = pino({ name: "ml-feature-store-consumer" });

// ─── Payload Types ───────────────────────────────────────────────────────────

interface LeadEventPayload {
  tenantId?: string;
  leadId: string;
}

interface TicketEventPayload {
  tenantId?: string;
  ticketId: string;
}

interface InventoryEventPayload {
  tenantId?: string;
  itemId: string;
  warehouseId?: string;
}

interface SubscriptionEventPayload {
  tenantId?: string;
  subscriptionId: string;
}

interface TaskEventPayload {
  tenantId?: string;
  taskId: string;
  projectId?: string;
}

interface TransactionEventPayload {
  tenantId?: string;
  transactionId: string;
}

// ─── Consumer Registration ───────────────────────────────────────────────────

export function registerFeatureStoreConsumers(queue: Queue): void {
  // ── Leads domain ──────────────────────────────────────────────────────────
  queue.subscribe(CONSUMED.leadCreated, async (msg: CommandEnvelope) => {
    await handleEntityEvent(msg, "leads", extractLeadEntityId);
  });

  queue.subscribe(CONSUMED.leadUpdated, async (msg: CommandEnvelope) => {
    await handleEntityEvent(msg, "leads", extractLeadEntityId);
  });

  // ── Tickets domain ────────────────────────────────────────────────────────
  queue.subscribe(CONSUMED.ticketCreated, async (msg: CommandEnvelope) => {
    await handleEntityEvent(msg, "tickets", extractTicketEntityId);
  });

  queue.subscribe(CONSUMED.ticketUpdated, async (msg: CommandEnvelope) => {
    await handleEntityEvent(msg, "tickets", extractTicketEntityId);
  });

  // ── Inventory domain ──────────────────────────────────────────────────────
  queue.subscribe(CONSUMED.movementPosted, async (msg: CommandEnvelope) => {
    await handleEntityEvent(msg, "inventory", extractInventoryEntityId);
  });

  queue.subscribe(CONSUMED.issuePosted, async (msg: CommandEnvelope) => {
    await handleEntityEvent(msg, "inventory", extractInventoryEntityId);
  });

  // ── Subscriptions domain ──────────────────────────────────────────────────
  queue.subscribe(CONSUMED.subscriptionUpdated, async (msg: CommandEnvelope) => {
    await handleEntityEvent(msg, "subscriptions", extractSubscriptionEntityId);
  });

  // ── Tasks domain ──────────────────────────────────────────────────────────
  queue.subscribe(CONSUMED.taskUpdated, async (msg: CommandEnvelope) => {
    await handleEntityEvent(msg, "tasks", extractTaskEntityId);
  });

  // ── Transactions domain ───────────────────────────────────────────────────
  queue.subscribe(CONSUMED.transactionPosted, async (msg: CommandEnvelope) => {
    await handleEntityEvent(msg, "transactions", extractTransactionEntityId);
  });

  log.info("feature-store consumers registered for all domain entity events");
}

// ─── Core Handler ────────────────────────────────────────────────────────────

async function handleEntityEvent(
  msg: CommandEnvelope,
  domain: FeatureDomain,
  extractEntityId: (payload: unknown) => string | null,
): Promise<void> {
  const startMs = Date.now();
  const tenantId = (msg.payload as { tenantId?: string }).tenantId ?? msg.tenantId;
  const entityId = extractEntityId(msg.payload);

  if (!entityId) {
    log.warn({ messageId: msg.messageId, domain }, "feature-store consumer: missing entityId — skipping");
    recordConsumerMessage({
      messageId: msg.messageId,
      topic: msg.type ?? domain,
      tenantId,
      processingTimeMs: Date.now() - startMs,
      outcome: "skipped",
    });
    return;
  }

  // Idempotency check via markProcessed
  const isNew = await db.transaction(async (tx) => {
    return markProcessed(tx, msg.messageId);
  });

  if (!isNew) {
    log.debug({ messageId: msg.messageId, domain, entityId }, "feature-store: already processed");
    recordConsumerMessage({
      messageId: msg.messageId,
      topic: msg.type ?? domain,
      tenantId,
      processingTimeMs: Date.now() - startMs,
      outcome: "skipped",
    });
    return;
  }

  // Recompute features for the affected entity
  try {
    await computeAndCache(tenantId, domain, entityId);

    const processingTimeMs = Date.now() - startMs;
    log.info(
      { messageId: msg.messageId, topic: msg.type, tenantId, domain, entityId, processingTimeMs, outcome: "processed" },
      "feature vector recomputed",
    );

    recordConsumerMessage({
      messageId: msg.messageId,
      topic: msg.type ?? domain,
      tenantId,
      processingTimeMs,
      outcome: "processed",
    });

    // Lead events have a stricter 5s SLA; others are 60s
    const slaMs = domain === "leads" ? 5_000 : 60_000;
    if (processingTimeMs > slaMs) {
      log.warn(
        { tenantId, domain, entityId, processingTimeMs, slaMs },
        `feature recomputation exceeded ${slaMs}ms SLA`,
      );
    }
  } catch (err) {
    const processingTimeMs = Date.now() - startMs;
    log.error(
      { messageId: msg.messageId, tenantId, domain, entityId, processingTimeMs, err: (err as Error).message, outcome: "failed" },
      "feature-store consumer: recomputation failed",
    );

    recordConsumerMessage({
      messageId: msg.messageId,
      topic: msg.type ?? domain,
      tenantId,
      processingTimeMs,
      outcome: "failed",
    });

    // Re-throw so the queue can retry / DLQ
    throw err;
  }
}

// ─── Entity ID Extractors ────────────────────────────────────────────────────

function extractLeadEntityId(payload: unknown): string | null {
  const p = payload as LeadEventPayload | null;
  return p?.leadId ?? null;
}

function extractTicketEntityId(payload: unknown): string | null {
  const p = payload as TicketEventPayload | null;
  return p?.ticketId ?? null;
}

function extractInventoryEntityId(payload: unknown): string | null {
  const p = payload as InventoryEventPayload | null;
  return p?.itemId ?? null;
}

function extractSubscriptionEntityId(payload: unknown): string | null {
  const p = payload as SubscriptionEventPayload | null;
  return p?.subscriptionId ?? null;
}

function extractTaskEntityId(payload: unknown): string | null {
  const p = payload as TaskEventPayload | null;
  return p?.taskId ?? null;
}

function extractTransactionEntityId(payload: unknown): string | null {
  const p = payload as TransactionEventPayload | null;
  return p?.transactionId ?? null;
}
