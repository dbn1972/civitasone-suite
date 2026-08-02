/**
 * Automation Rules Engine — CQRS routes (202 Accepted for mutations).
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ADMIN_ROLES = ["helpdesk_admin", "super_admin", "admin"];
const READER_ROLES = ["helpdesk_user", "helpdesk_agent", "helpdesk_admin", "super_admin", "admin"];

const triggerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("field_match"),
    field: z.string().min(1).max(64),
    value: z.string().min(1).max(256),
  }),
  z.object({
    type: z.literal("time_elapsed"),
    thresholdMinutes: z.number().int().min(1).max(525600),
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
  app.post("/v1/helpdesk/automation/rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createRuleBody.parse(req.body);
    return reply.code(202).send(await commands.createRule(ctx, body));
  });

  app.get("/v1/helpdesk/automation/rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const query = listQuery.parse(req.query);
    const { rows, total } = await queries.listRules(ctx.tenantId, query.limit, query.offset);
    return reply.send({
      data: rows,
      meta: { page: Math.floor(query.offset / query.limit) + 1, pageSize: query.limit, total },
    });
  });

  app.get("/v1/helpdesk/automation/rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const rule = await queries.getRule(ctx.tenantId, id);
    if (!rule) throw new HttpError(404, "NOT_FOUND", "automation rule not found");
    return reply.send({ data: rule });
  });

  app.patch("/v1/helpdesk/automation/rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateRuleBody.parse(req.body);
    return reply.code(202).send(await commands.updateRule(ctx, id, body));
  });

  app.delete("/v1/helpdesk/automation/rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.code(202).send(await commands.deleteRule(ctx, id));
  });

  app.post("/v1/helpdesk/automation/evaluate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const body = evaluateBody.parse(req.body);
    const matched = await queries.evaluate(ctx.tenantId, {
      fields: body.fields,
      elapsedMinutes: body.elapsedMinutes,
      subject: body.subject,
      ...(body.description !== undefined ? { description: body.description } : {}),
    });
    return reply.send({ data: matched });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
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
