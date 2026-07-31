import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { writeAudit } from "../../shared/audit.js";
import { READ_ROLES, ADMIN_ROLES } from "../../shared/roles.js";
import * as repo from "./repo.js";
import { evaluateRules, validateRule } from "./domain.js";

const checkBody = z.object({
  input: z.string().min(1).max(16000),
  agentId: z.string().uuid().optional(),
  rules: z.array(z.string().uuid()).optional(),
});

const RULE_TYPE_ENUM = z.enum(["pii", "profanity", "prompt_injection", "topic_block", "max_length"]);
const SEVERITY_ENUM = z.enum(["low", "medium", "high", "critical"]);

const createRuleBody = z.object({
  name: z.string().min(1).max(200),
  ruleType: RULE_TYPE_ENUM,
  pattern: z.string().max(500).optional(),
  config: z.record(z.unknown()).default({}),
  severity: SEVERITY_ENUM.default("medium"),
});

const updateRuleBody = z.object({
  name: z.string().min(1).max(200).optional(),
  pattern: z.string().max(500).optional(),
  config: z.record(z.unknown()).optional(),
  severity: SEVERITY_ENUM.optional(),
  status: z.enum(["active", "disabled"]).optional(),
  version: z.number().int().min(1),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["active", "disabled"]).optional(),
  ruleType: RULE_TYPE_ENUM.optional(),
  severity: SEVERITY_ENUM.optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function guardrailRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/ai/guardrails/check — evaluate text against the tenant's active rules
  app.post("/v1/ai/guardrails/check", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const body = checkBody.parse(req.body);

    const rules = await repo.listActive(ctx.tenantId, body.rules);
    const evaluation = evaluateRules(body.input, rules);

    await db.transaction(async (tx) => {
      // Redacted text only — DPDP Act 2023.
      await writeAudit(tx, ctx, {
        ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
        action: "guardrails.check",
        input: evaluation.sanitizedInput,
        output: null,
        blocked: !evaluation.passed,
        reason: evaluation.violations.map((v) => v.message).join("; ").slice(0, 500) || null,
      });
    });

    return reply.send({
      data: {
        passed: evaluation.passed,
        violations: evaluation.violations,
        sanitizedInput: evaluation.sanitizedInput,
        rulesEvaluated: rules.length,
      },
    });
  });

  // GET /v1/ai/guardrails/rules — list rules
  app.get("/v1/ai/guardrails/rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuery.parse(req.query);

    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, {
      ...(q.status !== undefined ? { status: q.status } : {}),
      ...(q.ruleType !== undefined ? { ruleType: q.ruleType } : {}),
      ...(q.severity !== undefined ? { severity: q.severity } : {}),
    });

    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({
      data: rows.map(repo.toView),
      meta: { page, pageSize: q.limit, total },
    });
  });

  // GET /v1/ai/guardrails/rules/:id — single rule
  app.get("/v1/ai/guardrails/rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);

    const rule = await repo.findById(id, ctx.tenantId);
    if (!rule) {
      throw new HttpError(404, "NOT_FOUND", "guardrail rule not found");
    }

    return reply.send({ data: repo.toView(rule) });
  });

  // POST /v1/ai/guardrails/rules — create a rule
  app.post("/v1/ai/guardrails/rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createRuleBody.parse(req.body);

    const ruleError = validateRule({
      ruleType: body.ruleType,
      pattern: body.pattern ?? null,
      config: body.config,
      severity: body.severity,
    });
    if (ruleError) {
      throw new HttpError(422, "RULE_INVALID", ruleError);
    }

    const id = randomUUID();

    await db.transaction(async (tx) => {
      await repo.insert(tx, {
        id,
        tenantId: ctx.tenantId,
        name: body.name,
        ruleType: body.ruleType,
        pattern: body.pattern ?? null,
        config: body.config,
        severity: body.severity,
        status: "active",
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      await writeAudit(tx, ctx, {
        action: "guardrails.rule_create",
        input: body.name,
        output: null,
        blocked: false,
        reason: null,
      });
    });

    return reply.status(201).send({
      data: {
        id,
        name: body.name,
        ruleType: body.ruleType,
        pattern: body.pattern ?? null,
        config: body.config,
        severity: body.severity,
        status: "active",
        version: 1,
      },
    });
  });

  // PATCH /v1/ai/guardrails/rules/:id — update a rule
  app.patch("/v1/ai/guardrails/rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateRuleBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "guardrail rule not found");
    }

    const ruleError = validateRule({
      ruleType: existing.ruleType,
      pattern: body.pattern ?? existing.pattern,
      config: body.config ?? existing.config,
      severity: body.severity ?? existing.severity,
    });
    if (ruleError) {
      throw new HttpError(422, "RULE_INVALID", ruleError);
    }

    const patch: Record<string, unknown> = { updatedBy: ctx.actorId };
    if (body.name !== undefined) patch.name = body.name;
    if (body.pattern !== undefined) patch.pattern = body.pattern;
    if (body.config !== undefined) patch.config = body.config;
    if (body.severity !== undefined) patch.severity = body.severity;
    if (body.status !== undefined) patch.status = body.status;

    await db.transaction(async (tx) => {
      const ok = await repo.update(tx, id, ctx.tenantId, patch, body.version);
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "rule has been modified; retry with current version");
      }

      await writeAudit(tx, ctx, {
        action: "guardrails.rule_update",
        input: JSON.stringify(Object.keys(patch)),
        output: null,
        blocked: false,
        reason: null,
      });
    });

    return reply.send({ data: { id, updated: true, version: body.version + 1 } });
  });

  // DELETE /v1/ai/guardrails/rules/:id — soft delete (disable)
  app.delete("/v1/ai/guardrails/rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "guardrail rule not found");
    }

    await db.transaction(async (tx) => {
      const ok = await repo.softDelete(tx, id, ctx.tenantId, existing.version, ctx.actorId);
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "rule has been modified; retry with current version");
      }

      await writeAudit(tx, ctx, {
        action: "guardrails.rule_delete",
        input: null,
        output: null,
        blocked: false,
        reason: null,
      });
    });

    return reply.status(204).send();
  });
}
