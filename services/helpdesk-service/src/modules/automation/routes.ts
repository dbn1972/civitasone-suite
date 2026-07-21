/**
 * Automation Rules Engine — CRUD + evaluation endpoint.
 *
 * Routes:
 *  POST   /v1/helpdesk/automation/rules       — create rule
 *  GET    /v1/helpdesk/automation/rules       — list rules for tenant
 *  GET    /v1/helpdesk/automation/rules/:id   — get rule by id
 *  PATCH  /v1/helpdesk/automation/rules/:id   — update rule
 *  DELETE /v1/helpdesk/automation/rules/:id   — soft-delete rule
 *  POST   /v1/helpdesk/automation/evaluate    — evaluate rules against ticket payload
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and, asc, sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { automationRules } from "./schema.js";
import { evaluateRules } from "./domain.js";
import type { AutomationTrigger, AutomationAction } from "./schema.js";

const ADMIN_ROLES = ["helpdesk_admin", "super_admin", "admin"];
const READER_ROLES = ["helpdesk_user", "helpdesk_agent", "helpdesk_admin", "super_admin", "admin"];

const MAX_RULES_PER_TENANT = 100;

// --- Validators ---

const triggerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("field_match"),
    field: z.string().min(1).max(64),
    value: z.string().min(1).max(256),
  }),
  z.object({
    type: z.literal("time_elapsed"),
    thresholdMinutes: z.number().int().min(1).max(525600), // max 1 year in minutes
  }),
  z.object({
    type: z.literal("keyword_match"),
    keywords: z.array(z.string().min(1).max(128)).min(1).max(50),
  }),
]);

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("assign"), to: z.string().uuid() }),
  z.object({ type: z.literal("escalate"), level: z.number().int().min(1).max(10) }),
  z.object({
    type: z.literal("notify"),
    channel: z.string().min(1).max(64),
    recipients: z.array(z.string().min(1).max(256)).min(1).max(20),
  }),
  z.object({
    type: z.literal("change_priority"),
    newPriority: z.enum(["Low", "Medium", "High", "Critical"]),
  }),
]);

const createRuleBody = z.object({
  name: z.string().min(1).max(255),
  ordinal: z.number().int().min(1).max(1000),
  enabled: z.boolean().optional().default(true),
  trigger: triggerSchema,
  actions: z.array(actionSchema).min(1).max(10),
});

const updateRuleBody = z.object({
  name: z.string().min(1).max(255).optional(),
  ordinal: z.number().int().min(1).max(1000).optional(),
  enabled: z.boolean().optional(),
  trigger: triggerSchema.optional(),
  actions: z.array(actionSchema).min(1).max(10).optional(),
});

const evaluateBody = z.object({
  fields: z.record(z.string(), z.string().optional()).default({}),
  elapsedMinutes: z.number().min(0).default(0),
  subject: z.string().min(1),
  description: z.string().optional(),
});

const idParam = z.object({ id: z.string().uuid() });

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function automationRoutes(app: FastifyInstance): Promise<void> {
  // Create automation rule
  app.post("/v1/helpdesk/automation/rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createRuleBody.parse(req.body);

    // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
    // before these queries — bare db.select()/db.insert() run with no RLS GUC set.
    const rule = await db.transaction(async (tx) => {
      // Enforce max 100 rules per tenant
      const [countRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(automationRules)
        .where(and(eq(automationRules.tenantId, ctx.tenantId), eq(automationRules.status, "active")));

      if ((countRow?.count ?? 0) >= MAX_RULES_PER_TENANT) {
        throw new HttpError(422, "RULE_LIMIT_REACHED", `maximum ${MAX_RULES_PER_TENANT} automation rules per tenant`);
      }

      const [created] = await tx.insert(automationRules).values({
        tenantId: ctx.tenantId,
        name: body.name,
        ordinal: body.ordinal,
        enabled: body.enabled,
        trigger: body.trigger as AutomationTrigger,
        actions: body.actions as AutomationAction[],
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      }).returning();

      return created;
    });

    return reply.code(201).send({ data: rule });
  });

  // List automation rules for tenant
  app.get("/v1/helpdesk/automation/rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const query = listQuery.parse(req.query);

    // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
    // before these reads — a bare db.select() runs with no RLS GUC set.
    const { rows, total } = await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(automationRules)
        .where(and(eq(automationRules.tenantId, ctx.tenantId), eq(automationRules.status, "active")))
        .orderBy(asc(automationRules.ordinal))
        .limit(query.limit)
        .offset(query.offset);

      const [countRow] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(automationRules)
        .where(and(eq(automationRules.tenantId, ctx.tenantId), eq(automationRules.status, "active")));

      return { rows, total: countRow?.total ?? 0 };
    });

    return reply.send({
      data: rows,
      meta: { page: Math.floor(query.offset / query.limit) + 1, pageSize: query.limit, total },
    });
  });

  // Get automation rule by ID
  app.get("/v1/helpdesk/automation/rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);

    // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
    // before this read — a bare db.select() runs with no RLS GUC set.
    const [rule] = await db.transaction((tx) =>
      tx
        .select()
        .from(automationRules)
        .where(and(eq(automationRules.id, id), eq(automationRules.tenantId, ctx.tenantId)))
        .limit(1),
    );

    if (!rule) throw new HttpError(404, "NOT_FOUND", "automation rule not found");
    return reply.send({ data: rule });
  });

  // Update automation rule
  app.patch("/v1/helpdesk/automation/rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateRuleBody.parse(req.body);

    // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
    // before these queries — bare db.select()/db.update() run with no RLS GUC set.
    const updated = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(automationRules)
        .where(and(eq(automationRules.id, id), eq(automationRules.tenantId, ctx.tenantId)))
        .limit(1);

      if (!existing) throw new HttpError(404, "NOT_FOUND", "automation rule not found");

      const updates: Record<string, unknown> = {
        updatedBy: ctx.actorId,
        updatedAt: new Date(),
        version: existing.version + 1,
      };
      if (body.name !== undefined) updates.name = body.name;
      if (body.ordinal !== undefined) updates.ordinal = body.ordinal;
      if (body.enabled !== undefined) updates.enabled = body.enabled;
      if (body.trigger !== undefined) updates.trigger = body.trigger;
      if (body.actions !== undefined) updates.actions = body.actions;

      const [row] = await tx
        .update(automationRules)
        .set(updates)
        .where(and(eq(automationRules.id, id), eq(automationRules.tenantId, ctx.tenantId)))
        .returning();

      return row;
    });

    return reply.send({ data: updated });
  });

  // Soft-delete automation rule
  app.delete("/v1/helpdesk/automation/rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);

    // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
    // before these queries — bare db.select()/db.update() run with no RLS GUC set.
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(automationRules)
        .where(and(eq(automationRules.id, id), eq(automationRules.tenantId, ctx.tenantId)))
        .limit(1);

      if (!existing) throw new HttpError(404, "NOT_FOUND", "automation rule not found");

      await tx
        .update(automationRules)
        .set({ status: "deleted", updatedBy: ctx.actorId, updatedAt: new Date() })
        .where(and(eq(automationRules.id, id), eq(automationRules.tenantId, ctx.tenantId)));
    });

    return reply.code(204).send();
  });

  // Evaluate rules against a ticket payload
  app.post("/v1/helpdesk/automation/evaluate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const body = evaluateBody.parse(req.body);

    // Fetch all enabled active rules for this tenant, ordered by ordinal.
    // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
    // before this read — a bare db.select() runs with no RLS GUC set.
    const rules = await db.transaction((tx) =>
      tx
        .select()
        .from(automationRules)
        .where(
          and(
            eq(automationRules.tenantId, ctx.tenantId),
            eq(automationRules.status, "active"),
            eq(automationRules.enabled, true),
          ),
        )
        .orderBy(asc(automationRules.ordinal)),
    );

    const matched = evaluateRules(
      {
        fields: body.fields as Record<string, string | undefined>,
        elapsedMinutes: body.elapsedMinutes,
        subject: body.subject,
        description: body.description,
      },
      rules.map((r) => ({
        id: r.id,
        name: r.name,
        ordinal: r.ordinal,
        enabled: r.enabled,
        trigger: r.trigger,
        actions: r.actions,
      })),
    );

    return reply.send({ data: matched });
  });

  // Error handler scoped to these routes
  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
