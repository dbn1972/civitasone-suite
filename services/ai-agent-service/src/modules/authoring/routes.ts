import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import { READ_ROLES, ADMIN_ROLES } from "../../shared/roles.js";
import * as repo from "./repo.js";
import { validateDefinition, publishBlockers, validateAuthoringTransition } from "./domain.js";
import * as commands from "./commands.js";

const toolSchema = z.record(z.unknown());

const createBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
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

    const tools = body.tools ?? [];
    const modelConfig = body.modelConfig ?? {};

    return reply.code(202).send(
      await commands.draftAgentDefinition(ctx, {
        name: body.name,
        description: body.description ?? null,
        systemPrompt: body.systemPrompt ?? "",
        tools,
        modelConfig,
      }),
    );
  });

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
    if (body.version !== existing.version) {
      throw new HttpError(409, "VERSION_CONFLICT", "definition has been modified; retry with current version");
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

    return reply.code(202).send(await commands.updateAgentDefinition(ctx, id, { version: body.version, patch }));
  });

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
    if (version !== existing.version) {
      throw new HttpError(409, "VERSION_CONFLICT", "definition has been modified; retry with current version");
    }

    return reply.code(202).send(
      await commands.publishAgentDefinition(ctx, id, {
        version,
        name: existing.name,
        toolCount: existing.tools.length,
      }),
    );
  });

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
    if (version !== existing.version) {
      throw new HttpError(409, "VERSION_CONFLICT", "definition has been modified; retry with current version");
    }

    return reply.code(202).send(await commands.archiveAgentDefinition(ctx, id, version));
  });

  app.post("/v1/ai/authoring/agents/:id/validate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const overrides = validateBody.parse(req.body ?? undefined) ?? {};

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "agent definition not found");
    }

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
