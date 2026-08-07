/**
 * ML Breach Prediction consumer — re-scores tickets on status/assignment updates.
 *
 * Listens to `helpdesk.ticket.updated` events (emitted by the ticket consumer
 * after any status transition or assignment change) and triggers a new breach
 * risk prediction. If the new prediction exceeds the high-risk threshold (>0.70),
 * emits the `ml.prediction.breach_risk_high` event for notification/escalation.
 *
 * This ensures real-time re-scoring on every ticket status or assignment update.
 */

import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { pino } from "pino";
import { eq, and, notInArray, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { queue as queueInstance } from "../../shared/infra.js";
import { EVENTS, CONSUMES } from "../../topics.js";
import { tickets } from "../tickets/schema.js";
import * as repo from "../tickets/repo.js";
import { predictBreachRisk } from "./adapter.js";
import {
  extractFeatures,
  buildFallbackResponse,
  classifyBreachRisk,
  selectReassignmentCandidates,
  BREACH_HIGH_THRESHOLD,
} from "./domain.js";

const logger = pino({ name: "ml-breach-consumer" });

interface TicketUpdatedPayload {
  ticketId: string;
  tenantId?: string;
}

export function registerBreachRiskConsumers(rawQueue: Queue): void {
  // #146 regression fix: run every handler inside the message tenant context so
  // NOBYPASSRLS + FORCE RLS accepts consumer writes (telephony PR #152 pattern).
  const queue = tenantScoped(rawQueue);
  // Re-score on ticket status transitions
  queue.subscribe<TicketUpdatedPayload>(EVENTS.ticketTransitioned, async (msg) => {
    const isNew = await db.transaction(async (tx) => markProcessed(tx, msg.messageId));
    if (!isNew) return;
    await rescoreTicket(msg.payload.ticketId, msg.tenantId, msg.correlationId);
  });

  // Re-score on ticket assignment changes
  queue.subscribe<TicketUpdatedPayload>(EVENTS.ticketAssigned, async (msg) => {
    const isNew = await db.transaction(async (tx) => markProcessed(tx, msg.messageId));
    if (!isNew) return;
    await rescoreTicket(msg.payload.ticketId, msg.tenantId, msg.correlationId);
  });

  // Re-score on ticket creation
  queue.subscribe<TicketUpdatedPayload>(EVENTS.ticketCreated, async (msg) => {
    const isNew = await db.transaction(async (tx) => markProcessed(tx, msg.messageId));
    if (!isNew) return;
    await rescoreTicket(msg.payload.ticketId, msg.tenantId, msg.correlationId);
  });
}

/**
 * Re-score a ticket's breach risk after a status or assignment update.
 * Emits `ml.prediction.breach_risk_high` if the risk exceeds the threshold.
 */
async function rescoreTicket(
  ticketId: string,
  tenantId: string,
  correlationId: string,
): Promise<void> {
  try {
    const ticket = await repo.findRow(ticketId, tenantId);
    if (!ticket) {
      logger.warn({ ticketId, tenantId }, "ticket not found for breach re-score");
      return;
    }

    // Skip closed/resolved tickets — no breach risk
    const status = ticket.status.toLowerCase();
    if (status === "closed" || status === "resolved") {
      return;
    }

    const now = new Date();
    const policies = await repo.getEffectivePolicies(tenantId);

    // Compute workload and queue depth
    const assigneeWorkload = ticket.assigneeId
      ? await countOpenTicketsForAgent(tenantId, ticket.assigneeId)
      : 0;
    const queueDepth = await countOpenTickets(tenantId);

    // Extract features
    const features = extractFeatures(ticket, now, assigneeWorkload, queueDepth, policies);

    // Call ml-service
    const mlResponse = await predictBreachRisk({
      tenantId,
      domain: "tickets",
      entityId: ticketId,
      features: {
        category: features.category,
        priority: features.priority,
        assigneeWorkload: features.assigneeWorkload,
        queueDepth: features.queueDepth,
        timeOfDay: features.timeOfDay,
        elapsedPctOfSla: features.elapsedPctOfSla,
      },
    });

    let probability: number;
    if (mlResponse && mlResponse.prediction !== null && !mlResponse.fallback) {
      probability = mlResponse.prediction;
    } else {
      // Fallback: use time-based detection
      const fallback = buildFallbackResponse(features, []);
      probability = fallback.probability;
    }

    // Emit breach_risk_high event if threshold exceeded
    if (probability > BREACH_HIGH_THRESHOLD) {
      await queueInstance.publish(CONSUMES.mlBreachRiskHigh, {
        type: CONSUMES.mlBreachRiskHigh,
        tenantId,
        actorId: "system",
        correlationId,
        schemaVersion: "1.0",
        payload: {
          domain: "tickets",
          entityId: ticketId,
          prediction: probability,
          confidence: probability,
          factors: mlResponse?.factors ?? [{ feature: "elapsedPctOfSla", contribution: features.elapsedPctOfSla, direction: "positive" }],
          timestamp: now.toISOString(),
        },
      });

      logger.info({ ticketId, tenantId, probability }, "breach risk high event emitted");
    }
  } catch (err) {
    logger.error({ ticketId, tenantId, err }, "failed to re-score ticket breach risk");
  }
}

// ── DB Helpers (duplicated from routes to keep consumer self-contained) ───

async function countOpenTicketsForAgent(tenantId: string, agentId: string): Promise<number> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const [row] = await db.transaction((tx) =>
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(tickets)
      .where(
        and(
          eq(tickets.tenantId, tenantId),
          eq(tickets.assigneeId, agentId),
          notInArray(tickets.status, ["closed", "resolved"]),
        ),
      ),
  );
  return row?.count ?? 0;
}

async function countOpenTickets(tenantId: string): Promise<number> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const [row] = await db.transaction((tx) =>
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(tickets)
      .where(
        and(
          eq(tickets.tenantId, tenantId),
          notInArray(tickets.status, ["closed", "resolved"]),
        ),
      ),
  );
  return row?.count ?? 0;
}
