import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { READ_ROLES, ADMIN_ROLES } from "../../shared/roles.js";
import * as repo from "./repo.js";
import * as guardrailsRepo from "../guardrails/repo.js";
import { evaluateRules } from "../guardrails/domain.js";
import {
  validateAgentDefinition,
  validateAgentStatusTransition,
  canInvoke,
  selectHandoffTarget,
} from "./domain.js";
import * as commands from "./commands.js";

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

    const accepted = await commands.handoffAgent(ctx, {
      fromAgentId: from.id,
      toAgentId: target.id,
      toAgentName: target.name,
      requiredSkill: body.requiredSkill,
      ...(body.conversationId !== undefined ? { conversationId: body.conversationId } : {}),
    });

    return reply.code(202).send({
      ...accepted,
      data: { fromAgentId: from.id, toAgentId: target.id, toAgentName: target.name, status: "handed_off" },
    });
  });

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

    const skills = body.skills ?? [];
    const tools = body.tools ?? [];

    return reply.code(202).send(
      await commands.createAgent(ctx, { name: body.name, skills, tools }),
    );
  });

  app.patch("/v1/ai/agents/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateAgentBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "agent not found");
    }

    if (body.version !== existing.version) {
      throw new HttpError(409, "VERSION_CONFLICT", "agent has been modified; retry with current version");
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

    return reply.code(202).send(await commands.updateAgent(ctx, id, { version: body.version, patch }));
  });

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

    return reply.code(202).send(await commands.deleteAgent(ctx, id, existing.version));
  });

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
    if (version !== existing.version) {
      throw new HttpError(409, "VERSION_CONFLICT", "agent has been modified; retry with current version");
    }

    return reply.code(202).send(await commands.pauseAgent(ctx, id, version));
  });

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
    if (version !== existing.version) {
      throw new HttpError(409, "VERSION_CONFLICT", "agent has been modified; retry with current version");
    }

    return reply.code(202).send(await commands.resumeAgent(ctx, id, version));
  });

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
        await commands.recordBlockedAudit(ctx, {
          agentId: id,
          action: "agent.invoke",
          input: evaluation.sanitizedInput,
          reason,
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
    const accepted = await commands.invokeAgent(ctx, id, {
      invocationId,
      sanitizedInput,
      ...(body.conversationId !== undefined ? { conversationId: body.conversationId } : {}),
    });

    return reply.code(202).send({
      ...accepted,
      data: { agentId: id, invocationId, status: "invoked" },
    });
  });
}
