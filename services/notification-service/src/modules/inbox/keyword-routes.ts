/**
 * CR-MKT-06 — keyword auto-response configuration.
 *
 * POST  /v1/notification/inbox/keyword-rules        — create a rule (202)
 * GET   /v1/notification/inbox/keyword-rules        — list rules
 * PATCH /v1/notification/inbox/keyword-rules/:id    — update a rule (202)
 * POST  /v1/notification/inbox/keyword-match        — dry-run the matcher
 *
 * The dry-run endpoint exists so an operator can see exactly which rule would
 * win for a given message before enabling it, using the same pure matcher the
 * consumer uses. It records nothing.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { matchKeywordRule, planAutoResponse, normalizeKeyword } from "./keyword-domain.js";
import * as commands from "./keyword-commands.js";
import * as repo from "./keyword-repo.js";

const WRITE_ROLES = ["notification_admin", "super_admin", "tenant_admin", "platform_admin", "crm_admin"];
const READ_ROLES = [...WRITE_ROLES, "helpdesk_user", "audit_officer"];

const INBOUND_CHANNELS = ["sms", "whatsapp", "email", "web_chat", "social"] as const;

const createBody = z.object({
  keyword: z.string().min(1).max(120),
  matchType: z.enum(["exact", "prefix", "contains"]).default("exact"),
  channel: z.enum(INBOUND_CHANNELS).optional(),
  priority: z.number().int().min(0).max(10_000).default(100),
  responseBody: z.string().min(1).max(1600).optional(),
  action: z.string().min(1).max(40).optional(),
});

const updateBody = z.object({
  keyword: z.string().min(1).max(120).optional(),
  matchType: z.enum(["exact", "prefix", "contains"]).optional(),
  channel: z.enum(INBOUND_CHANNELS).nullable().optional(),
  priority: z.number().int().min(0).max(10_000).optional(),
  responseBody: z.string().min(1).max(1600).nullable().optional(),
  action: z.string().min(1).max(40).nullable().optional(),
  enabled: z.boolean().optional(),
}).refine((v) => Object.keys(v).length > 0, "at least one field must be provided");

const matchBody = z.object({
  message: z.string().min(1).max(4000),
  channel: z.enum(INBOUND_CHANNELS),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200),
  offset: z.coerce.number().int().min(0).default(0),
});

const idParam = z.object({ id: z.string().uuid() });

export async function keywordRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/notification/inbox/keyword-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createBody.parse(req.body);
    // 422: a rule that neither replies nor triggers an action would match and
    // then do nothing — a silent no-op is worse than a rejected config.
    if (body.responseBody === undefined && body.action === undefined) {
      throw new HttpError(422, "EMPTY_RULE", "a rule needs at least one of responseBody or action");
    }
    // 422: after normalisation the keyword must still contain something matchable.
    if (normalizeKeyword(body.keyword).length === 0) {
      throw new HttpError(422, "EMPTY_KEYWORD", "keyword contains no matchable characters");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.createKeywordRule(ctx, {
      keyword: body.keyword,
      matchType: body.matchType,
      priority: body.priority,
      ...(body.channel !== undefined ? { channel: body.channel } : {}),
      ...(body.responseBody !== undefined ? { responseBody: body.responseBody } : {}),
      ...(body.action !== undefined ? { action: body.action } : {}),
    }));
  });

  app.get("/v1/notification/inbox/keyword-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listKeywordRules(ctx.tenantId, q.limit, q.offset);
    return reply.send({
      data: rows.map((r) => ({
        id: r.id,
        keyword: r.keyword,
        matchType: r.matchType,
        channel: r.channel,
        priority: r.priority,
        responseBody: r.responseBody,
        action: r.action,
        enabled: r.enabled,
      })),
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });

  app.patch("/v1/notification/inbox/keyword-rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateBody.parse(req.body);
    const existing = await repo.findKeywordRuleById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "keyword rule not found");
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateKeywordRule(ctx, id, body));
  });

  app.post("/v1/notification/inbox/keyword-match", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const body = matchBody.parse(req.body);
    const rules = await repo.findEnabledRules(ctx.tenantId);
    const match = matchKeywordRule(rules, body.message, body.channel);
    return reply.send({
      data: {
        normalizedMessage: normalizeKeyword(body.message),
        matchedRuleId: match?.rule.id ?? null,
        matchedKeyword: match?.rule.keyword ?? null,
        matchType: match?.rule.matchType ?? null,
        plan: planAutoResponse(match),
      },
    });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
