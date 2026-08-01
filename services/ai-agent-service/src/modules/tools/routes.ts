import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { READ_ROLES, ADMIN_ROLES } from "../../shared/roles.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as agentsRepo from "../agents/repo.js";
import { decideReactStep, defaultToolsFor, validateToolDefinition } from "./domain.js";

const DOMAIN_ENUM = z.enum(["crm", "helpdesk", "finance", "hrms", "generic"]);

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  agentDomain: DOMAIN_ENUM.optional(),
  enabled: z.enum(["true", "false"]).optional(),
  requiresApproval: z.enum(["true", "false"]).optional(),
});

const createBody = z.object({
  agentDomain: DOMAIN_ENUM,
  toolName: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  inputSchema: z.record(z.unknown()).optional(),
  requiresApproval: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

const updateBody = z.object({
  description: z.string().max(2000).optional(),
  inputSchema: z.record(z.unknown()).optional(),
  requiresApproval: z.boolean().optional(),
  enabled: z.boolean().optional(),
  version: z.number().int().min(1),
});

const seedBody = z.object({ agentDomain: DOMAIN_ENUM.optional() }).optional();

const reactStepBody = z.object({
  thought: z.string().min(1).max(8000),
  action: z.string().min(1).max(120),
  actionInput: z.record(z.unknown()).default({}),
  observation: z.string().max(8000).optional(),
  agentDomain: DOMAIN_ENUM.default("generic"),
  orchestrationId: z.string().uuid().optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function toolRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/ai/tools — tool catalogue; ?agentDomain=crm|helpdesk gives the
  // CRM/Sales and Service/ticket agent tool sets (F.4)
  app.get("/v1/ai/tools", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuery.parse(req.query);

    const hash = `${q.limit}:${q.offset}:${q.agentDomain ?? "all"}:${q.enabled ?? "all"}:${q.requiresApproval ?? "all"}`;
    const key = cache.makeKey(ctx.tenantId, "tools", hash);

    const loaded = await cache.getOrLoad(key, async () => {
      const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, {
        ...(q.agentDomain !== undefined ? { agentDomain: q.agentDomain } : {}),
        ...(q.enabled !== undefined ? { enabled: q.enabled === "true" } : {}),
        ...(q.requiresApproval !== undefined ? { requiresApproval: q.requiresApproval === "true" } : {}),
      });
      return { data: rows.map(repo.toView), total };
    });

    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({
      data: loaded?.data ?? [],
      meta: { page, pageSize: q.limit, total: loaded?.total ?? 0 },
    });
  });

  // POST /v1/ai/tools — define a tool (F.4)
  app.post("/v1/ai/tools", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createBody.parse(req.body);

    const defError = validateToolDefinition({
      agentDomain: body.agentDomain,
      toolName: body.toolName,
      inputSchema: body.inputSchema,
    });
    if (defError) {
      throw new HttpError(422, "TOOL_INVALID", defError);
    }

    const duplicate = await repo.findByName(ctx.tenantId, body.agentDomain, body.toolName);
    if (duplicate) {
      throw new HttpError(409, "TOOL_EXISTS", `tool ${body.agentDomain}/${body.toolName} already exists`);
    }

    const id = randomUUID();
    const inputSchema = body.inputSchema ?? {};
    const requiresApproval = body.requiresApproval ?? false;
    const enabled = body.enabled ?? true;

    await db.transaction(async (tx) => {
      await repo.insert(tx, {
        id,
        tenantId: ctx.tenantId,
        agentDomain: body.agentDomain,
        toolName: body.toolName,
        description: body.description ?? null,
        inputSchema,
        requiresApproval,
        enabled,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.toolDefined,
        eventType: EVENTS.toolDefined,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { toolId: id, agentDomain: body.agentDomain, toolName: body.toolName, requiresApproval },
      });

      await writeAudit(tx, ctx, {
        action: "tool.define",
        input: `${body.agentDomain}/${body.toolName}`,
        output: id,
        blocked: false,
        reason: null,
      });
    });

    await cache.invalidateResource(ctx.tenantId, "tools");

    return reply.status(201).send({
      data: {
        id,
        agentDomain: body.agentDomain,
        toolName: body.toolName,
        description: body.description ?? null,
        inputSchema,
        requiresApproval,
        enabled,
        version: 1,
      },
    });
  });

  // POST /v1/ai/tools/seed-defaults — materialise the CRM/helpdesk defaults (F.4)
  app.post("/v1/ai/tools/seed-defaults", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = seedBody.parse(req.body ?? undefined) ?? {};

    const templates = defaultToolsFor(body.agentDomain);
    if (templates.length === 0) {
      throw new HttpError(422, "NO_TEMPLATES", "no default tools exist for that agent domain");
    }

    let inserted = 0;
    await db.transaction(async (tx) => {
      inserted = await repo.insertManyIgnoreConflicts(
        tx,
        templates.map((t) => ({
          id: randomUUID(),
          tenantId: ctx.tenantId,
          agentDomain: t.agentDomain,
          toolName: t.toolName,
          description: t.description,
          inputSchema: t.inputSchema,
          requiresApproval: t.requiresApproval,
          enabled: true,
          createdBy: ctx.actorId,
          updatedBy: ctx.actorId,
        })),
      );

      await writeAudit(tx, ctx, {
        action: "tool.seed_defaults",
        input: body.agentDomain ?? "all",
        output: String(inserted),
        blocked: false,
        reason: null,
      });
    });

    await cache.invalidateResource(ctx.tenantId, "tools");

    return reply.status(202).send({
      data: { requested: templates.length, inserted, skipped: templates.length - inserted },
    });
  });

  // PATCH /v1/ai/tools/:id — update a tool definition (F.4)
  app.patch("/v1/ai/tools/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "tool definition not found");
    }

    if (body.inputSchema !== undefined) {
      const defError = validateToolDefinition({
        agentDomain: existing.agentDomain,
        toolName: existing.toolName,
        inputSchema: body.inputSchema,
      });
      if (defError) {
        throw new HttpError(422, "TOOL_INVALID", defError);
      }
    }

    const patch: Record<string, unknown> = { updatedBy: ctx.actorId };
    if (body.description !== undefined) patch.description = body.description;
    if (body.inputSchema !== undefined) patch.inputSchema = body.inputSchema;
    if (body.requiresApproval !== undefined) patch.requiresApproval = body.requiresApproval;
    if (body.enabled !== undefined) patch.enabled = body.enabled;

    await db.transaction(async (tx) => {
      const ok = await repo.update(tx, id, ctx.tenantId, patch, body.version);
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "tool has been modified; retry with current version");
      }

      await enqueue(tx, {
        topic: EVENTS.toolUpdated,
        eventType: EVENTS.toolUpdated,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { toolId: id, agentDomain: existing.agentDomain, toolName: existing.toolName },
      });

      await writeAudit(tx, ctx, {
        action: "tool.update",
        input: JSON.stringify(Object.keys(patch)),
        output: null,
        blocked: false,
        reason: null,
      });
    });

    await cache.invalidateResource(ctx.tenantId, "tools");

    return reply.send({ data: { id, updated: true, version: body.version + 1 } });
  });

  // POST /v1/ai/agents/:id/react-step — record one ReAct reasoning step (F.4)
  app.post("/v1/ai/agents/:id/react-step", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const body = reactStepBody.parse(req.body);

    const agent = await agentsRepo.findById(id, ctx.tenantId);
    if (!agent) {
      throw new HttpError(404, "NOT_FOUND", "agent not found");
    }
    if (agent.status !== "active") {
      throw new HttpError(422, "AGENT_NOT_INVOCABLE", `agent is ${agent.status}; only active agents may reason`);
    }

    // The action names the tool the agent wants to use. An unknown tool is a
    // hallucinated action and must not be recorded as a step.
    const tool = await repo.findByName(ctx.tenantId, body.agentDomain, body.action);
    if (!tool) {
      throw new HttpError(404, "TOOL_NOT_FOUND", `no tool ${body.agentDomain}/${body.action} is defined`);
    }

    const decision = decideReactStep({ enabled: tool.enabled, requiresApproval: tool.requiresApproval });
    if (decision.code === "TOOL_DISABLED") {
      throw new HttpError(422, "TOOL_DISABLED", decision.message);
    }

    const stepId = randomUUID();
    const priorSteps = await repo.countSteps(ctx.tenantId, id);

    await db.transaction(async (tx) => {
      await repo.insertStep(tx, {
        id: stepId,
        tenantId: ctx.tenantId,
        agentId: id,
        ...(body.orchestrationId !== undefined ? { orchestrationId: body.orchestrationId } : {}),
        toolId: tool.id,
        stepNo: priorSteps + 1,
        thought: body.thought,
        action: body.action,
        actionInput: body.actionInput,
        observation: body.observation ?? null,
        status: decision.status,
        // Never derived from the request body: the governance decision owns this flag.
        executed: decision.executed,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      await enqueue(tx, {
        topic: decision.executed ? EVENTS.reactStepRecorded : EVENTS.reactStepPendingApproval,
        eventType: decision.executed ? EVENTS.reactStepRecorded : EVENTS.reactStepPendingApproval,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          agentId: id,
          stepId,
          action: body.action,
          toolId: tool.id,
          executed: decision.executed,
        },
      });

      // Thought/observation text is redacted by writeAudit before it is stored.
      await writeAudit(tx, ctx, {
        agentId: id,
        action: "agent.react_step",
        input: body.thought,
        output: body.observation ?? null,
        blocked: !decision.executed,
        reason: decision.executed ? null : decision.message,
      });
    });

    return reply.status(202).send({
      data: {
        stepId,
        agentId: id,
        toolId: tool.id,
        action: body.action,
        stepNo: priorSteps + 1,
        status: decision.status,
        executed: decision.executed,
        requiresApproval: tool.requiresApproval,
        code: decision.code,
        message: decision.message,
      },
    });
  });
}
