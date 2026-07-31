import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { READ_ROLES, ADMIN_ROLES } from "../../shared/roles.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as guardrailsRepo from "../guardrails/repo.js";
import { evaluateRules } from "../guardrails/domain.js";
import {
  validateAgentDefinition,
  validateAgentStatusTransition,
  canInvoke,
  selectHandoffTarget,
} from "./domain.js";

const skillSchema = z.record(z.unknown());

const createAgentBody = z.object({
  name: z.string().min(1).max(200),
  skills: z.array(skillSchema).optional(),
  tools: z.array(skillSchema).optional(),
});

const updateAgentBody = z.object({
  name: z.string().min(1).max(200).optional(),
  skills: z.array(skillSchema).optional(),
  tools: z.array(skillSchema).optional(),
  status: z.enum(["active", "paused", "archived"]).optional(),
  version: z.number().int().min(1),
});

const invokeBody = z.object({
  input: z.string().min(1).max(16000).optional(),
  payload: z.record(z.unknown()).optional(),
  conversationId: z.string().uuid().optional(),
}).optional();

const handoffBody = z.object({
  fromAgentId: z.string().uuid(),
  requiredSkill: z.string().min(1).max(200),
  conversationId: z.string().uuid().optional(),
});

const versionBody = z.object({ version: z.number().int().min(1).optional() }).optional();

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["active", "paused", "archived"]).optional(),
  search: z.string().max(200).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/ai/agents — list agent definitions
  app.get("/v1/ai/agents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuery.parse(req.query);

    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, {
      ...(q.status !== undefined ? { status: q.status } : {}),
      ...(q.search !== undefined ? { search: q.search } : {}),
    });

    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({
      data: rows.map(repo.toView),
      meta: { page, pageSize: q.limit, total },
    });
  });

  // POST /v1/ai/agents/handoff — route work to the best-matching agent
  app.post("/v1/ai/agents/handoff", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const body = handoffBody.parse(req.body);

    const from = await repo.findById(body.fromAgentId, ctx.tenantId);
    if (!from) {
      throw new HttpError(404, "NOT_FOUND", "source agent not found");
    }

    const candidates = await repo.listByStatus(ctx.tenantId, "active");
    const target = selectHandoffTarget(
      body.requiredSkill,
      candidates.filter((c) => c.id !== from.id).map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        skills: c.skills,
      })),
    );

    if (!target) {
      throw new HttpError(422, "NO_HANDOFF_TARGET", `no active agent has skill: ${body.requiredSkill}`);
    }

    await db.transaction(async (tx) => {
      await enqueue(tx, {
        topic: EVENTS.handoffTriggered,
        eventType: EVENTS.handoffTriggered,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          fromAgentId: from.id,
          toAgentId: target.id,
          requiredSkill: body.requiredSkill,
          ...(body.conversationId !== undefined ? { conversationId: body.conversationId } : {}),
        },
      });

      await writeAudit(tx, ctx, {
        agentId: from.id,
        action: "agent.handoff",
        input: body.requiredSkill,
        output: target.id,
        blocked: false,
        reason: null,
      });
    });

    return reply.status(202).send({
      data: { fromAgentId: from.id, toAgentId: target.id, toAgentName: target.name, status: "handed_off" },
    });
  });

  // GET /v1/ai/agents/:id — single agent
  app.get("/v1/ai/agents/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);

    const agent = await repo.findById(id, ctx.tenantId);
    if (!agent) {
      throw new HttpError(404, "NOT_FOUND", "agent not found");
    }

    return reply.send({ data: repo.toView(agent) });
  });

  // POST /v1/ai/agents — create an agent definition
  app.post("/v1/ai/agents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createAgentBody.parse(req.body);

    const definitionError = validateAgentDefinition({
      name: body.name,
      skills: body.skills,
      tools: body.tools,
    });
    if (definitionError) {
      throw new HttpError(422, "AGENT_DEFINITION_INVALID", definitionError);
    }

    const id = randomUUID();
    const skills = body.skills ?? [];
    const tools = body.tools ?? [];

    await db.transaction(async (tx) => {
      await repo.insert(tx, {
        id,
        tenantId: ctx.tenantId,
        name: body.name,
        skills,
        tools,
        status: "active",
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      await writeAudit(tx, ctx, {
        agentId: id,
        action: "agent.create",
        input: body.name,
        output: null,
        blocked: false,
        reason: null,
      });
    });

    return reply.status(201).send({
      data: { id, name: body.name, skills, tools, status: "active", version: 1 },
    });
  });

  // PATCH /v1/ai/agents/:id — update definition or status
  app.patch("/v1/ai/agents/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateAgentBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "agent not found");
    }

    if (body.name !== undefined || body.skills !== undefined || body.tools !== undefined) {
      const definitionError = validateAgentDefinition({
        name: body.name ?? existing.name,
        skills: body.skills ?? existing.skills,
        tools: body.tools ?? existing.tools,
      });
      if (definitionError) {
        throw new HttpError(422, "AGENT_DEFINITION_INVALID", definitionError);
      }
    }

    if (body.status !== undefined && body.status !== existing.status) {
      const transitionError = validateAgentStatusTransition(existing.status, body.status);
      if (transitionError) {
        throw new HttpError(422, "INVALID_TRANSITION", transitionError);
      }
    }

    const patch: Record<string, unknown> = { updatedBy: ctx.actorId };
    if (body.name !== undefined) patch.name = body.name;
    if (body.skills !== undefined) patch.skills = body.skills;
    if (body.tools !== undefined) patch.tools = body.tools;
    if (body.status !== undefined) patch.status = body.status;

    await db.transaction(async (tx) => {
      const ok = await repo.update(tx, id, ctx.tenantId, patch, body.version);
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "agent has been modified; retry with current version");
      }

      await writeAudit(tx, ctx, {
        agentId: id,
        action: "agent.update",
        input: JSON.stringify(Object.keys(patch)),
        output: null,
        blocked: false,
        reason: null,
      });
    });

    return reply.send({ data: { id, updated: true, version: body.version + 1 } });
  });

  // DELETE /v1/ai/agents/:id — soft delete (archive)
  app.delete("/v1/ai/agents/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "agent not found");
    }

    const transitionError = validateAgentStatusTransition(existing.status, "archived");
    if (transitionError) {
      throw new HttpError(422, "INVALID_TRANSITION", transitionError);
    }

    await db.transaction(async (tx) => {
      const ok = await repo.archive(tx, id, ctx.tenantId, existing.version, ctx.actorId);
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "agent has been modified; retry with current version");
      }

      await writeAudit(tx, ctx, {
        agentId: id,
        action: "agent.archive",
        input: null,
        output: null,
        blocked: false,
        reason: null,
      });
    });

    return reply.status(204).send();
  });

  // POST /v1/ai/agents/:id/pause — active → paused
  app.post("/v1/ai/agents/:id/pause", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = versionBody.parse(req.body ?? undefined) ?? {};

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "agent not found");
    }

    const transitionError = validateAgentStatusTransition(existing.status, "paused");
    if (transitionError) {
      throw new HttpError(422, "INVALID_TRANSITION", transitionError);
    }

    const version = body.version ?? existing.version;

    await db.transaction(async (tx) => {
      const ok = await repo.update(tx, id, ctx.tenantId, { status: "paused", updatedBy: ctx.actorId }, version);
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "agent has been modified; retry with current version");
      }

      await enqueue(tx, {
        topic: EVENTS.agentPaused,
        eventType: EVENTS.agentPaused,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { agentId: id },
      });

      await writeAudit(tx, ctx, {
        agentId: id,
        action: "agent.pause",
        input: null,
        output: null,
        blocked: false,
        reason: null,
      });
    });

    return reply.send({ data: { agentId: id, status: "paused", version: version + 1 } });
  });

  // POST /v1/ai/agents/:id/resume — paused → active
  app.post("/v1/ai/agents/:id/resume", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = versionBody.parse(req.body ?? undefined) ?? {};

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "agent not found");
    }

    const transitionError = validateAgentStatusTransition(existing.status, "active");
    if (transitionError) {
      throw new HttpError(422, "INVALID_TRANSITION", transitionError);
    }

    const version = body.version ?? existing.version;

    await db.transaction(async (tx) => {
      const ok = await repo.update(tx, id, ctx.tenantId, { status: "active", updatedBy: ctx.actorId }, version);
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "agent has been modified; retry with current version");
      }

      await writeAudit(tx, ctx, {
        agentId: id,
        action: "agent.resume",
        input: null,
        output: null,
        blocked: false,
        reason: null,
      });
    });

    return reply.send({ data: { agentId: id, status: "active", version: version + 1 } });
  });

  // POST /v1/ai/agents/:id/invoke — dispatch work to an agent
  app.post("/v1/ai/agents/:id/invoke", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const body = invokeBody.parse(req.body ?? undefined) ?? {};

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "agent not found");
    }

    if (!canInvoke(existing.status)) {
      throw new HttpError(422, "AGENT_NOT_INVOCABLE", `agent is ${existing.status}; only active agents accept invocations`);
    }

    let sanitizedInput: string | null = null;
    if (body.input !== undefined) {
      const rules = await guardrailsRepo.listActive(ctx.tenantId);
      const evaluation = evaluateRules(body.input, rules);
      sanitizedInput = evaluation.sanitizedInput;

      if (!evaluation.passed) {
        const reason = evaluation.violations.map((v) => v.message).join("; ").slice(0, 500);
        await db.transaction(async (tx) => {
          // Redacted text only — DPDP Act 2023.
          await writeAudit(tx, ctx, {
            agentId: id,
            action: "agent.invoke",
            input: evaluation.sanitizedInput,
            output: null,
            blocked: true,
            reason,
          });
        });
        return reply.status(422).send({
          code: "GUARDRAIL_BLOCKED",
          message: "input blocked by guardrails",
          correlationId: ctx.correlationId,
          retryable: false,
          details: { violations: evaluation.violations },
        });
      }
    }

    const invocationId = randomUUID();

    await db.transaction(async (tx) => {
      await enqueue(tx, {
        topic: EVENTS.turnCompleted,
        eventType: EVENTS.turnCompleted,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          agentId: id,
          invocationId,
          ...(body.conversationId !== undefined ? { conversationId: body.conversationId } : {}),
        },
      });

      await writeAudit(tx, ctx, {
        agentId: id,
        action: "agent.invoke",
        input: sanitizedInput,
        output: null,
        blocked: false,
        reason: null,
      });
    });

    return reply.status(202).send({
      data: { agentId: id, invocationId, status: "invoked" },
    });
  });
}
