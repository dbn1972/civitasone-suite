import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { READ_ROLES, ADMIN_ROLES } from "../../shared/roles.js";
import * as repo from "./repo.js";
import { evaluateRules, validateRule } from "./domain.js";
import { detectInjection, blocksInteraction } from "./injection-domain.js";
import * as commands from "./commands.js";

const checkBody = z.object({
  input: z.string().min(1).max(16000),
  agentId: z.string().uuid().optional(),
  rules: z.array(z.string().uuid()).optional(),
});

const injectionBody = z.object({
  input: z.string().min(1).max(16000),
  agentId: z.string().uuid().optional(),
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
  app.post("/v1/ai/guardrails/check", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const body = checkBody.parse(req.body);

    const rules = await repo.listActive(ctx.tenantId, body.rules);
    const evaluation = evaluateRules(body.input, rules);

    const injection = detectInjection(body.input);
    const injectionBlocks = blocksInteraction(injection);
    const violations = [...evaluation.violations];
    if (injection.detected) {
      violations.push({
        ruleId: "builtin:prompt_injection",
        ruleType: "prompt_injection",
        severity: injection.severity,
        message: `prompt injection patterns detected: ${injection.patterns.join(", ")}`,
      });
    }
    const passed = evaluation.passed && !injectionBlocks;

    await commands.checkGuardrails(ctx, {
      sanitizedInput: evaluation.sanitizedInput,
      passed,
      reason: violations.map((v) => v.message).join("; ").slice(0, 500) || null,
      ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
      injectionDetected: injection.detected,
      injectionSeverity: injection.severity,
      injectionPatterns: injection.patterns,
      injectionBlocked: injectionBlocks,
    });

    return reply.send({
      data: {
        passed,
        violations,
        sanitizedInput: evaluation.sanitizedInput,
        rulesEvaluated: rules.length,
        injection,
      },
    });
  });

  app.post("/v1/ai/guardrails/check-injection", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const body = injectionBody.parse(req.body);

    const injection = detectInjection(body.input);
    const blocked = blocksInteraction(injection);

    if (injection.detected) {
      await commands.checkInjection(ctx, {
        ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
        severity: injection.severity,
        patterns: injection.patterns,
        blocked,
      });
    }

    return reply.send({
      data: {
        detected: injection.detected,
        patterns: injection.patterns,
        severity: injection.severity,
        blocked,
      },
    });
  });

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

    return reply.code(202).send(
      await commands.createGuardrailRule(ctx, {
        name: body.name,
        ruleType: body.ruleType,
        pattern: body.pattern ?? null,
        config: body.config,
        severity: body.severity,
      }),
    );
  });

  app.patch("/v1/ai/guardrails/rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateRuleBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "guardrail rule not found");
    }
    if (body.version !== existing.version) {
      throw new HttpError(409, "VERSION_CONFLICT", "rule has been modified; retry with current version");
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

    return reply.code(202).send(await commands.updateGuardrailRule(ctx, id, { version: body.version, patch }));
  });

  app.delete("/v1/ai/guardrails/rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "guardrail rule not found");
    }

    return reply.code(202).send(await commands.deleteGuardrailRule(ctx, id, existing.version));
  });
}
