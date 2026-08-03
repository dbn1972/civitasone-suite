/**
 * Routing Module Routes
 *
 * Endpoints:
 *  GET    /v1/helpdesk/routing/rules            — list routing rules
 *  POST   /v1/helpdesk/routing/rules            — create rule (202)
 *  PATCH  /v1/helpdesk/routing/rules/:id        — update rule (202)
 *  DELETE /v1/helpdesk/routing/rules/:id        — soft-delete (202)
 *  POST   /v1/helpdesk/routing/evaluate         — dry-run evaluate
 *  POST   /v1/helpdesk/routing/rules/validate   — detect conflicts
 *  GET    /v1/helpdesk/routing/agents           — list agents + capacity
 *  PATCH  /v1/helpdesk/routing/agents/:agentId/capacity — update capacity (202)
 *  GET    /v1/helpdesk/routing/queues           — list queues
 *  POST   /v1/helpdesk/routing/queues/enqueue   — add to queue (202)
 *  POST   /v1/helpdesk/routing/queues/dequeue   — pick next from queue (202)
 *  GET    /v1/helpdesk/routing/failures         — list failures
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and, sql, desc, asc } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { routingRules } from "./schema.js";
import { agentCapacity } from "./capacity-schema.js";
import { holdQueue } from "./queue-schema.js";
import { routingFailures } from "./failure-log-schema.js";
import {
  selectAgent,
  validateRulePrecedence,
  detectConflicts,
} from "./domain.js";
import * as commands from "./commands.js";

const HELPDESK_ROLES = ["helpdesk_user", "helpdesk_agent", "helpdesk_admin", "super_admin", "admin"];
const ADMIN_ROLES = ["helpdesk_admin", "super_admin", "admin"];

const createRuleBody = z.object({
  name: z.string().min(1).max(255),
  strategy: z.enum(["round_robin", "weighted", "skill_based", "least_busy"]),
  criteria: z.record(z.unknown()).nullable().optional(),
  weight: z.number().int().min(0).max(100).default(1),
  enabled: z.boolean().default(true),
  ordinal: z.number().int().min(0).default(0),
});

const updateRuleBody = z.object({
  name: z.string().min(1).max(255).optional(),
  strategy: z.enum(["round_robin", "weighted", "skill_based", "least_busy"]).optional(),
  criteria: z.record(z.unknown()).nullable().optional(),
  weight: z.number().int().min(0).max(100).optional(),
  enabled: z.boolean().optional(),
  ordinal: z.number().int().min(0).optional(),
});

const evaluateBody = z.object({
  priority: z.string().min(1).optional(),
  category: z.string().optional(),
  skills: z.array(z.string()).optional(),
  ticketId: z.string().uuid().optional(),
});

const updateCapacityBody = z.object({
  maxTickets: z.number().int().min(1).max(100).optional(),
  skills: z.array(z.string()).optional(),
  available: z.boolean().optional(),
});

const enqueueBody = z.object({
  ticketId: z.string().uuid(),
  queueName: z.string().min(1).max(128).default("default"),
  priority: z.number().int().min(0).max(10).default(0),
});

const dequeueBody = z.object({
  queueName: z.string().min(1).max(128).default("default"),
});

const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function routingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/helpdesk/routing/rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const query = paginationQuery.parse(req.query);

    const rows = await db.transaction((tx) =>
      tx
        .select()
        .from(routingRules)
        .where(and(eq(routingRules.tenantId, ctx.tenantId), eq(routingRules.enabled, true)))
        .orderBy(asc(routingRules.ordinal))
        .limit(query.limit)
        .offset(query.offset),
    );

    const [countRow] = await db.transaction((tx) =>
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(routingRules)
        .where(and(eq(routingRules.tenantId, ctx.tenantId), eq(routingRules.enabled, true))),
    );

    return reply.send({
      data: rows,
      meta: { page: Math.floor(query.offset / query.limit) + 1, pageSize: query.limit, total: countRow?.count ?? 0 },
    });
  });

  app.post("/v1/helpdesk/routing/rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createRuleBody.parse(req.body);
    return reply.code(202).send(
      await commands.createRule(ctx, {
        name: body.name,
        strategy: body.strategy,
        criteria: body.criteria ?? null,
        weight: body.weight,
        enabled: body.enabled,
        ordinal: body.ordinal,
      }),
    );
  });

  app.patch("/v1/helpdesk/routing/rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = updateRuleBody.parse(req.body);

    const [existing] = await db.transaction((tx) =>
      tx
        .select()
        .from(routingRules)
        .where(and(eq(routingRules.id, id), eq(routingRules.tenantId, ctx.tenantId)))
        .limit(1),
    );
    if (!existing) throw new HttpError(404, "NOT_FOUND", "routing rule not found");

    return reply.code(202).send(
      await commands.updateRule(ctx, id, {
        version: existing.version,
        ...(body.name !== undefined && { name: body.name }),
        ...(body.strategy !== undefined && { strategy: body.strategy }),
        ...(body.criteria !== undefined && { criteria: body.criteria ?? null }),
        ...(body.weight !== undefined && { weight: body.weight }),
        ...(body.enabled !== undefined && { enabled: body.enabled }),
        ...(body.ordinal !== undefined && { ordinal: body.ordinal }),
      }),
    );
  });

  app.delete("/v1/helpdesk/routing/rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const [existing] = await db.transaction((tx) =>
      tx
        .select()
        .from(routingRules)
        .where(and(eq(routingRules.id, id), eq(routingRules.tenantId, ctx.tenantId)))
        .limit(1),
    );
    if (!existing) throw new HttpError(404, "NOT_FOUND", "routing rule not found");

    return reply.code(202).send(await commands.deleteRule(ctx, id));
  });

  app.post("/v1/helpdesk/routing/evaluate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    evaluateBody.parse(req.body);

    const rules = await db.transaction((tx) =>
      tx
        .select()
        .from(routingRules)
        .where(and(eq(routingRules.tenantId, ctx.tenantId), eq(routingRules.enabled, true)))
        .orderBy(asc(routingRules.ordinal)),
    );

    if (rules.length === 0) {
      return reply.send({ data: { selectedAgentId: null, ruleName: null, reason: "no_rules_configured" } });
    }

    const agents = await db.transaction((tx) =>
      tx
        .select()
        .from(agentCapacity)
        .where(and(eq(agentCapacity.tenantId, ctx.tenantId), eq(agentCapacity.available, true))),
    );

    for (const rule of rules) {
      const result = selectAgent(rule, agents);
      if (result.agentId) {
        return reply.send({
          data: {
            selectedAgentId: result.agentId,
            ruleName: rule.name,
            strategy: rule.strategy,
            reason: result.reason,
          },
        });
      }
    }

    return reply.send({ data: { selectedAgentId: null, ruleName: null, reason: "no_agents_available" } });
  });

  app.post("/v1/helpdesk/routing/rules/validate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);

    const rules = await db.transaction((tx) =>
      tx.select().from(routingRules).where(eq(routingRules.tenantId, ctx.tenantId)),
    );

    const precedenceIssues = validateRulePrecedence(rules);
    const conflicts = detectConflicts(rules);

    return reply.send({
      data: {
        valid: conflicts.length === 0 && precedenceIssues.length === 0,
        conflicts,
        precedenceIssues,
        totalRules: rules.length,
        enabledRules: rules.filter((r) => r.enabled).length,
      },
    });
  });

  app.get("/v1/helpdesk/routing/agents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const query = paginationQuery.parse(req.query);

    const rows = await db.transaction((tx) =>
      tx
        .select()
        .from(agentCapacity)
        .where(eq(agentCapacity.tenantId, ctx.tenantId))
        .limit(query.limit)
        .offset(query.offset),
    );

    const [countRow] = await db.transaction((tx) =>
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(agentCapacity)
        .where(eq(agentCapacity.tenantId, ctx.tenantId)),
    );

    return reply.send({
      data: rows,
      meta: { page: Math.floor(query.offset / query.limit) + 1, pageSize: query.limit, total: countRow?.count ?? 0 },
    });
  });

  app.patch("/v1/helpdesk/routing/agents/:agentId/capacity", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { agentId } = z.object({ agentId: z.string().uuid() }).parse(req.params);
    const body = updateCapacityBody.parse(req.body);

    return reply.code(202).send(
      await commands.upsertCapacity(ctx, agentId, {
        ...(body.maxTickets !== undefined ? { maxTickets: body.maxTickets } : {}),
        ...(body.skills !== undefined ? { skills: body.skills } : {}),
        ...(body.available !== undefined ? { available: body.available } : {}),
      }),
    );
  });

  app.get("/v1/helpdesk/routing/queues", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);

    const rows = await db.transaction((tx) =>
      tx
        .select({
          queueName: holdQueue.queueName,
          count: sql<number>`count(*)::int`,
          oldestEntry: sql<string>`min(${holdQueue.enteredAt})`,
          highestPriority: sql<number>`max(${holdQueue.priority})`,
        })
        .from(holdQueue)
        .where(eq(holdQueue.tenantId, ctx.tenantId))
        .groupBy(holdQueue.queueName),
    );

    return reply.send({ data: rows });
  });

  app.post("/v1/helpdesk/routing/queues/enqueue", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const body = enqueueBody.parse(req.body);
    return reply.code(202).send(await commands.enqueueTicket(ctx, body));
  });

  app.post("/v1/helpdesk/routing/queues/dequeue", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const body = dequeueBody.parse(req.body);
    return reply.code(202).send(await commands.dequeueTicket(ctx, body));
  });

  app.get("/v1/helpdesk/routing/failures", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const query = paginationQuery.parse(req.query);

    const rows = await db.transaction((tx) =>
      tx
        .select()
        .from(routingFailures)
        .where(eq(routingFailures.tenantId, ctx.tenantId))
        .orderBy(desc(routingFailures.attemptedAt))
        .limit(query.limit)
        .offset(query.offset),
    );

    const [countRow] = await db.transaction((tx) =>
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(routingFailures)
        .where(eq(routingFailures.tenantId, ctx.tenantId)),
    );

    return reply.send({
      data: rows,
      meta: { page: Math.floor(query.offset / query.limit) + 1, pageSize: query.limit, total: countRow?.count ?? 0 },
    });
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
