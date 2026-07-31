import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { READ_ROLES } from "../../shared/roles.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as guardrailsRepo from "../guardrails/repo.js";
import { evaluateRules } from "../guardrails/domain.js";
import { validatePrompt, buildCitations, computeLatencyBucket } from "./domain.js";

const sourceSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  url: z.string().optional(),
  score: z.number().optional(),
});

const askBody = z.object({
  // Upper bound is deliberately looser than the domain limit so an over-long
  // prompt surfaces as a 422 business-rule violation, not a 400 schema error.
  prompt: z.string().min(1).max(32000),
  context: z.record(z.unknown()).optional(),
  model: z.string().max(64).optional(),
  sources: z.array(sourceSchema).max(100).optional(),
});

const summarizeBody = z.object({
  content: z.string().min(1).max(32000),
  maxLength: z.number().int().min(50).max(2000).optional(),
  model: z.string().max(64).optional(),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  userId: z.string().uuid().optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function copilotRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/ai/copilot/ask — validate, guardrail, persist the turn
  app.post("/v1/ai/copilot/ask", async (req, reply) => {
    const startedAt = Date.now();
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const body = askBody.parse(req.body);

    const promptError = validatePrompt(body.prompt);
    if (promptError) {
      throw new HttpError(422, "PROMPT_INVALID", promptError);
    }

    const rules = await guardrailsRepo.listActive(ctx.tenantId);
    const evaluation = evaluateRules(body.prompt, rules);

    if (!evaluation.passed) {
      const reason = evaluation.violations.map((v) => v.message).join("; ").slice(0, 500);
      await db.transaction(async (tx) => {
        // Redacted text only — DPDP Act 2023.
        await writeAudit(tx, ctx, {
          action: "copilot.ask",
          input: evaluation.sanitizedInput,
          output: null,
          blocked: true,
          reason,
        });
      });
      return reply.status(422).send({
        code: "GUARDRAIL_BLOCKED",
        message: "prompt blocked by guardrails",
        correlationId: ctx.correlationId,
        retryable: false,
        details: { violations: evaluation.violations },
      });
    }

    const id = randomUUID();
    const citations = buildCitations(body.sources ?? []);
    const latencyMs = Date.now() - startedAt;

    await db.transaction(async (tx) => {
      await repo.insert(tx, {
        id,
        tenantId: ctx.tenantId,
        userId: ctx.actorId,
        prompt: evaluation.sanitizedInput,
        response: null,
        sourceCitations: citations,
        model: body.model ?? null,
        tokens: null,
        latencyMs,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.turnCompleted,
        eventType: EVENTS.turnCompleted,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { turnId: id, kind: "copilot_ask", citations: citations.length, latencyMs },
      });

      await writeAudit(tx, ctx, {
        action: "copilot.ask",
        input: evaluation.sanitizedInput,
        output: null,
        blocked: false,
        reason: evaluation.violations.length > 0 ? "guardrail warnings recorded" : null,
      });
    });

    return reply.status(201).send({
      data: {
        id,
        status: "accepted",
        citations,
        latencyMs,
        latencyBucket: computeLatencyBucket(latencyMs),
        sanitizedInput: evaluation.sanitizedInput,
        guardrail: { passed: true, violations: evaluation.violations },
      },
    });
  });

  // POST /v1/ai/copilot/summarize — persist a summarisation turn
  app.post("/v1/ai/copilot/summarize", async (req, reply) => {
    const startedAt = Date.now();
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const body = summarizeBody.parse(req.body);

    const rules = await guardrailsRepo.listActive(ctx.tenantId);
    const evaluation = evaluateRules(body.content, rules);

    if (!evaluation.passed) {
      const reason = evaluation.violations.map((v) => v.message).join("; ").slice(0, 500);
      await db.transaction(async (tx) => {
        await writeAudit(tx, ctx, {
          action: "copilot.summarize",
          input: evaluation.sanitizedInput,
          output: null,
          blocked: true,
          reason,
        });
      });
      return reply.status(422).send({
        code: "GUARDRAIL_BLOCKED",
        message: "content blocked by guardrails",
        correlationId: ctx.correlationId,
        retryable: false,
        details: { violations: evaluation.violations },
      });
    }

    const id = randomUUID();
    const latencyMs = Date.now() - startedAt;

    await db.transaction(async (tx) => {
      await repo.insert(tx, {
        id,
        tenantId: ctx.tenantId,
        userId: ctx.actorId,
        prompt: evaluation.sanitizedInput,
        response: null,
        sourceCitations: [],
        model: body.model ?? null,
        tokens: null,
        latencyMs,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      await writeAudit(tx, ctx, {
        action: "copilot.summarize",
        input: evaluation.sanitizedInput,
        output: null,
        blocked: false,
        reason: null,
      });
    });

    return reply.status(201).send({
      data: {
        id,
        status: "accepted",
        maxLength: body.maxLength ?? null,
        latencyBucket: computeLatencyBucket(latencyMs),
      },
    });
  });

  // GET /v1/ai/copilot/turns — paginated turn history
  app.get("/v1/ai/copilot/turns", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuery.parse(req.query);

    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, {
      ...(q.userId !== undefined ? { userId: q.userId } : {}),
    });

    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({
      data: rows.map(repo.toView),
      meta: { page, pageSize: q.limit, total },
    });
  });

  // GET /v1/ai/copilot/turns/:id — single turn
  app.get("/v1/ai/copilot/turns/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);

    const turn = await repo.findById(id, ctx.tenantId);
    if (!turn) {
      throw new HttpError(404, "NOT_FOUND", "copilot turn not found");
    }

    const view = repo.toView(turn);
    return reply.send({
      data: { ...view, latencyBucket: computeLatencyBucket(turn.latencyMs ?? 0) },
    });
  });
}
