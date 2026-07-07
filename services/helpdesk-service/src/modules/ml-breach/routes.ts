/**
 * ML Breach Prediction routes.
 *
 * Exposes `GET /v1/helpdesk/tickets/:id/breach-risk` returning the SLA breach
 * probability, risk classification, explainability factors, and reassignment
 * candidates.
 *
 * Calls ml-service internally via circuit-breaker–protected HTTP. Falls back
 * to time-based at-risk detection (80% elapsed threshold) when no model
 * is available.
 */

import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and, notInArray, sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { tickets } from "../tickets/schema.js";
import { CONSUMES } from "../../topics.js";
import * as repo from "../tickets/repo.js";
import { predictBreachRisk } from "./adapter.js";
import {
  extractFeatures,
  buildFallbackResponse,
  buildMlResponse,
  selectReassignmentCandidates,
  classifyBreachRisk,
  BREACH_HIGH_THRESHOLD,
} from "./domain.js";

const HELPDESK_ROLES = ["helpdesk_user", "helpdesk_agent", "helpdesk_admin", "super_admin", "admin"];

const idParam = z.object({ id: z.string().uuid() });

export async function mlBreachRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/helpdesk/tickets/:id/breach-risk
   *
   * Returns breach probability, risk level, factors, and reassignment candidates.
   * Falls back to time-based detection when ML model is unavailable.
   */
  app.get("/v1/helpdesk/tickets/:id/breach-risk", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const { id } = idParam.parse(req.params);

    // Fetch ticket
    const ticket = await repo.findRow(id, ctx.tenantId);
    if (!ticket) {
      throw new HttpError(404, "NOT_FOUND", "ticket not found");
    }

    const now = new Date();

    // Load SLA policies for elapsed % computation
    const policies = await repo.getEffectivePolicies(ctx.tenantId);

    // Compute assignee workload: count of open tickets assigned to same agent
    const assigneeWorkload = ticket.assigneeId
      ? await countOpenTicketsForAgent(ctx.tenantId, ticket.assigneeId)
      : 0;

    // Compute queue depth: total open tickets in tenant queue
    const queueDepth = await countOpenTickets(ctx.tenantId);

    // Extract features
    const features = extractFeatures(ticket, now, assigneeWorkload, queueDepth, policies);

    // Get reassignment candidates (agents with lowest workload)
    const agentWorkloads = await getAgentWorkloads(ctx.tenantId);
    const candidates = selectReassignmentCandidates(agentWorkloads, ticket.assigneeId);

    // Call ml-service
    const mlResponse = await predictBreachRisk({
      tenantId: ctx.tenantId,
      domain: "tickets",
      entityId: id,
      features: {
        category: features.category,
        priority: features.priority,
        assigneeWorkload: features.assigneeWorkload,
        queueDepth: features.queueDepth,
        timeOfDay: features.timeOfDay,
        elapsedPctOfSla: features.elapsedPctOfSla,
      },
    });

    // If ML prediction available and not a fallback from ml-service itself
    if (mlResponse && mlResponse.prediction !== null && !mlResponse.fallback) {
      const response = buildMlResponse(mlResponse.prediction, mlResponse.factors, candidates);

      // Emit breach_risk_high event if threshold exceeded
      if (response.breachRisk === "high") {
        await emitBreachRiskHighEvent(ctx.tenantId, id, response.probability, response.factors, req.id);
      }

      return reply.send({ data: response });
    }

    // Fallback: time-based at-risk detection (80% elapsed threshold)
    const fallbackResponse = buildFallbackResponse(features, candidates);

    // Emit breach_risk_high event for fallback too if threshold exceeded
    if (fallbackResponse.breachRisk === "high") {
      await emitBreachRiskHighEvent(ctx.tenantId, id, fallbackResponse.probability, fallbackResponse.factors, req.id);
    }

    return reply.send({ data: fallbackResponse });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "invalid request", correlationId } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, correlationId } });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "internal error", correlationId } });
  });
}

// ── Helpers ───────────────────────────────────────────────────────

/** Count open tickets assigned to a specific agent in a tenant. */
async function countOpenTicketsForAgent(tenantId: string, agentId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tickets)
    .where(
      and(
        eq(tickets.tenantId, tenantId),
        eq(tickets.assigneeId, agentId),
        notInArray(tickets.status, ["closed", "resolved"]),
      ),
    );
  return row?.count ?? 0;
}

/** Count total open tickets in a tenant queue. */
async function countOpenTickets(tenantId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tickets)
    .where(
      and(
        eq(tickets.tenantId, tenantId),
        notInArray(tickets.status, ["closed", "resolved"]),
      ),
    );
  return row?.count ?? 0;
}

/** Get open ticket counts per assigned agent in a tenant. */
async function getAgentWorkloads(tenantId: string): Promise<Array<{ agentId: string; workload: number }>> {
  const rows = await db
    .select({
      agentId: tickets.assigneeId,
      workload: sql<number>`count(*)::int`,
    })
    .from(tickets)
    .where(
      and(
        eq(tickets.tenantId, tenantId),
        notInArray(tickets.status, ["closed", "resolved"]),
        sql`${tickets.assigneeId} IS NOT NULL`,
      ),
    )
    .groupBy(tickets.assigneeId);

  return rows
    .filter((r): r is { agentId: string; workload: number } => r.agentId !== null)
    .map((r) => ({ agentId: r.agentId, workload: r.workload }));
}

/** Emit ml.prediction.breach_risk_high event for notification + escalation consumers. */
async function emitBreachRiskHighEvent(
  tenantId: string,
  ticketId: string,
  probability: number,
  factors: Array<{ feature: string; contribution: number; direction: string }>,
  correlationId: string,
): Promise<void> {
  try {
    await queue.publish(CONSUMES.mlBreachRiskHigh, {
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
        factors,
        timestamp: new Date().toISOString(),
      },
    });
  } catch {
    // Non-critical: log but don't fail the request
    // (breachRisk response is still returned to caller)
  }
}
