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
import { validateDefinition, publishBlockers, validateAuthoringTransition } from "./domain.js";

const toolSchema = z.record(z.unknown());

const createBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  // Upper bound is looser than the domain limit so an over-long prompt surfaces
  // as a 422 business-rule violation rather than a 400 schema error.
  systemPrompt: z.string().max(32000).optional(),
  tools: z.array(toolSchema).optional(),
  modelConfig: z.record(z.unknown()).optional(),
});

const updateBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  systemPrompt: z.string().max(32000).optional(),
  tools: z.array(toolSchema).optional(),
  modelConfig: z.record(z.unknown()).optional(),
  version: z.number().int().min(1),
});

const validateBody = z.object({
  name: z.string().max(200).optional(),
  systemPrompt: z.string().max(32000).optional(),
  tools: z.array(toolSchema).optional(),
  modelConfig: z.record(z.unknown()).optional(),
}).optional();

const versionBody = z.object({ version: z.number().int().min(1).optional() }).optional();

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["draft", "published", "archived"]).optional(),
  search: z.string().max(200).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function authoringRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/ai/authoring/agents — list authored definitions (AG-003)
  app.get("/v1/ai/authoring/agents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuery.parse(req.query);

    const hash = `${q.limit}:${q.offset}:${q.status ?? "all"}:${q.search ?? ""}`;
    const key = cache.makeKey(ctx.tenantId, "authoring-agents", hash);

    const loaded = await cache.getOrLoad(key, async () => {
      const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, {
        ...(q.status !== undefined ? { status: q.status } : {}),
        ...(q.search !== undefined ? { search: q.search } : {}),
      });
      return { data: rows.map(repo.toView), total };
    });

    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({
      data: loaded?.data ?? [],
      meta: { page, pageSize: q.limit, total: loaded?.total ?? 0 },
    });
  });

  // POST /v1/ai/authoring/agents — create a draft (AG-003)
  app.post("/v1/ai/authoring/agents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createBody.parse(req.body);

    const report = validateDefinition({
      name: body.name,
      systemPrompt: body.systemPrompt,
      tools: body.tools,
      modelConfig: body.modelConfig,
    });
    if (!report.valid) {
      throw new HttpError(422, "DEFINITION_INVALID", report.issues.map((i) => i.message).join("; "));
    }

    const duplicate = await repo.findByName(body.name, ctx.tenantId);
    if (duplicate) {
      throw new HttpError(409, "NAME_TAKEN", `an agent definition named "${body.name}" already exists`);
    }

    const id = randomUUID();
    const tools = body.tools ?? [];
    const modelConfig = body.modelConfig ?? {};

    await db.transaction(async (tx) => {
      await repo.insert(tx, {
        id,
        tenantId: ctx.tenantId,
        name: body.name,
        description: body.description ?? null,
        systemPrompt: body.systemPrompt ?? "",
        tools,
        modelConfig,
        status: "draft",
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.agentDefinitionDrafted,
        eventType: EVENTS.agentDefinitionDrafted,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { definitionId: id, name: body.name },
      });

      await writeAudit(tx, ctx, {
        action: "authoring.create",
        input: body.name,
        output: id,
        blocked: false,
        reason: null,
      });
    });

    await cache.invalidateResource(ctx.tenantId, "authoring-agents");

    return reply.status(201).send({
      data: {
        id,
        name: body.name,
        description: body.description ?? null,
        systemPrompt: body.systemPrompt ?? "",
        tools,
        modelConfig,
        status: "draft",
        publishedAt: null,
        version: 1,
        validation: report,
      },
    });
  });

  // PATCH /v1/ai/authoring/agents/:id — edit a definition (AG-003)
  app.patch("/v1/ai/authoring/agents/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "agent definition not found");
    }
    if (existing.status === "archived") {
      throw new HttpError(422, "DEFINITION_ARCHIVED", "an archived definition cannot be edited");
    }

    const merged = {
      name: body.name ?? existing.name,
      systemPrompt: body.systemPrompt ?? existing.systemPrompt,
      tools: body.tools ?? existing.tools,
      modelConfig: body.modelConfig ?? existing.modelConfig,
    };
    const report = validateDefinition(merged);
    if (!report.valid) {
      throw new HttpError(422, "DEFINITION_INVALID", report.issues.map((i) => i.message).join("; "));
    }

    const patch: Record<string, unknown> = { updatedBy: ctx.actorId };
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.systemPrompt !== undefined) patch.systemPrompt = body.systemPrompt;
    if (body.tools !== undefined) patch.tools = body.tools;
    if (body.modelConfig !== undefined) patch.modelConfig = body.modelConfig;

    await db.transaction(async (tx) => {
      const ok = await repo.update(tx, id, ctx.tenantId, patch, body.version);
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "definition has been modified; retry with current version");
      }

      await writeAudit(tx, ctx, {
        action: "authoring.update",
        input: JSON.stringify(Object.keys(patch)),
        output: null,
        blocked: false,
        reason: null,
      });
    });

    // The list read is cache-first, so the write path must drop it.
    await cache.invalidateResource(ctx.tenantId, "authoring-agents");

    return reply.send({ data: { id, updated: true, version: body.version + 1, validation: report } });
  });

  // POST /v1/ai/authoring/agents/:id/publish — draft → published (AG-003)
  app.post("/v1/ai/authoring/agents/:id/publish", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = versionBody.parse(req.body ?? undefined) ?? {};

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "agent definition not found");
    }

    const transitionError = validateAuthoringTransition(existing.status, "published");
    if (transitionError) {
      throw new HttpError(422, "INVALID_TRANSITION", transitionError);
    }

    // Publish gate: an agent with no prompt or no tools cannot do anything, and
    // publishing it would put a dead agent in front of citizens.
    const blockers = publishBlockers({
      name: existing.name,
      systemPrompt: existing.systemPrompt,
      tools: existing.tools,
      modelConfig: existing.modelConfig,
    });
    if (blockers.length > 0) {
      return reply.status(422).send({
        code: "NOT_PUBLISHABLE",
        message: blockers.map((i) => i.message).join("; "),
        correlationId: ctx.correlationId,
        retryable: false,
        details: { issues: blockers },
      });
    }

    const version = body.version ?? existing.version;
    const publishedAt = new Date();

    await db.transaction(async (tx) => {
      const ok = await repo.update(
        tx,
        id,
        ctx.tenantId,
        { status: "published", publishedAt, updatedBy: ctx.actorId },
        version,
      );
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "definition has been modified; retry with current version");
      }

      await enqueue(tx, {
        topic: EVENTS.agentDefinitionPublished,
        eventType: EVENTS.agentDefinitionPublished,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { definitionId: id, name: existing.name, toolCount: existing.tools.length },
      });

      await writeAudit(tx, ctx, {
        action: "authoring.publish",
        input: existing.name,
        output: null,
        blocked: false,
        reason: null,
      });
    });

    await cache.invalidateResource(ctx.tenantId, "authoring-agents");

    return reply.status(202).send({
      data: {
        id,
        status: "published",
        publishedAt: publishedAt.toISOString(),
        version: version + 1,
      },
    });
  });

  // POST /v1/ai/authoring/agents/:id/archive — retire a definition (AG-003)
  app.post("/v1/ai/authoring/agents/:id/archive", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = versionBody.parse(req.body ?? undefined) ?? {};

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "agent definition not found");
    }

    const transitionError = validateAuthoringTransition(existing.status, "archived");
    if (transitionError) {
      throw new HttpError(422, "INVALID_TRANSITION", transitionError);
    }

    const version = body.version ?? existing.version;

    await db.transaction(async (tx) => {
      const ok = await repo.update(
        tx,
        id,
        ctx.tenantId,
        { status: "archived", updatedBy: ctx.actorId },
        version,
      );
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "definition has been modified; retry with current version");
      }

      await enqueue(tx, {
        topic: EVENTS.agentDefinitionArchived,
        eventType: EVENTS.agentDefinitionArchived,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { definitionId: id },
      });

      await writeAudit(tx, ctx, {
        action: "authoring.archive",
        input: null,
        output: null,
        blocked: false,
        reason: null,
      });
    });

    await cache.invalidateResource(ctx.tenantId, "authoring-agents");

    return reply.status(202).send({ data: { id, status: "archived", version: version + 1 } });
  });

  // POST /v1/ai/authoring/agents/:id/validate — dry run, persists nothing (AG-003)
  app.post("/v1/ai/authoring/agents/:id/validate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const overrides = validateBody.parse(req.body ?? undefined) ?? {};

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "agent definition not found");
    }

    // Overrides let an author validate unsaved edits before committing them.
    const report = validateDefinition({
      name: overrides.name ?? existing.name,
      systemPrompt: overrides.systemPrompt ?? existing.systemPrompt,
      tools: overrides.tools ?? existing.tools,
      modelConfig: overrides.modelConfig ?? existing.modelConfig,
    });

    return reply.send({
      data: {
        id,
        status: existing.status,
        valid: report.valid,
        publishable: report.publishable,
        issues: report.issues,
      },
    });
  });
}
