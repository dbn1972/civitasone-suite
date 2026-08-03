import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import { READ_ROLES, ADMIN_ROLES } from "../../shared/roles.js";
import * as agentsRepo from "./repo.js";
import * as repo from "./orchestration-repo.js";
import {
  canHandoff,
  normalizeLimits,
  summarizeHopTrace,
  validateOrchestrationTransition,
} from "./orchestration-domain.js";
import * as commands from "./orchestration/commands.js";

const startBody = z.object({
  rootAgentId: z.string().uuid(),
  maxDepth: z.number().int().min(1).max(20).optional(),
  maxHops: z.number().int().min(1).max(200).optional(),
});

const handoffBody = z.object({
  fromAgentId: z.string().uuid(),
  toAgentId: z.string().uuid(),
  reason: z.string().min(1).max(2000),
});

const abortBody = z.object({
  reason: z.string().min(1).max(500),
  version: z.number().int().min(1).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function orchestrationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/ai/orchestrations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const body = startBody.parse(req.body);

    const rootAgent = await agentsRepo.findById(body.rootAgentId, ctx.tenantId);
    if (!rootAgent) {
      throw new HttpError(404, "NOT_FOUND", "root agent not found");
    }
    if (rootAgent.status !== "active") {
      throw new HttpError(
        422,
        "AGENT_NOT_INVOCABLE",
        `root agent is ${rootAgent.status}; only active agents can root an orchestration`,
      );
    }

    const limits = normalizeLimits(body.maxDepth, body.maxHops);
    const id = randomUUID();

    await commands.startOrchestration(ctx, {
      id,
      rootAgentId: body.rootAgentId,
      maxDepth: limits.maxDepth,
      maxHops: limits.maxHops,
    });

    return reply.status(202).send({
      data: {
        id,
        rootAgentId: body.rootAgentId,
        status: "accepted",
        depth: 0,
        hopCount: 0,
        maxDepth: limits.maxDepth,
        maxHops: limits.maxHops,
        version: 1,
        correlationId: ctx.correlationId,
      },
    });
  });

  app.post("/v1/ai/orchestrations/:id/handoff", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const body = handoffBody.parse(req.body);

    const orchestration = await repo.findById(id, ctx.tenantId);
    if (!orchestration) {
      throw new HttpError(404, "NOT_FOUND", "orchestration not found");
    }

    const decision = canHandoff(
      { status: orchestration.status, depth: orchestration.depth, hopCount: orchestration.hopCount },
      orchestration.maxDepth,
      orchestration.maxHops,
    );

    if (!decision.allowed) {
      await commands.recordOrchestrationLimit(ctx, {
        orchestrationId: id,
        fromAgentId: body.fromAgentId,
        code: decision.code ?? "LIMIT_EXCEEDED",
        reason: decision.reason ?? "handoff refused",
        depth: orchestration.depth,
        hopCount: orchestration.hopCount,
        maxDepth: orchestration.maxDepth,
        maxHops: orchestration.maxHops,
      });

      return reply.status(422).send({
        code: decision.code,
        message: decision.reason,
        correlationId: ctx.correlationId,
        retryable: false,
        details: {
          depth: orchestration.depth,
          maxDepth: orchestration.maxDepth,
          hopCount: orchestration.hopCount,
          maxHops: orchestration.maxHops,
        },
      });
    }

    const hopId = randomUUID();

    await commands.recordHandoff(ctx, id, {
      hopId,
      fromAgentId: body.fromAgentId,
      toAgentId: body.toAgentId,
      reason: body.reason,
      nextDepth: decision.nextDepth,
      nextHopCount: decision.nextHopCount,
      version: orchestration.version,
    });

    return reply.status(202).send({
      data: {
        orchestrationId: id,
        hopId,
        fromAgentId: body.fromAgentId,
        toAgentId: body.toAgentId,
        depth: decision.nextDepth,
        hopCount: decision.nextHopCount,
        status: "accepted",
        version: orchestration.version + 1,
        correlationId: ctx.correlationId,
      },
    });
  });

  app.post("/v1/ai/orchestrations/:id/abort", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = abortBody.parse(req.body);

    const orchestration = await repo.findById(id, ctx.tenantId);
    if (!orchestration) {
      throw new HttpError(404, "NOT_FOUND", "orchestration not found");
    }

    const transitionError = validateOrchestrationTransition(orchestration.status, "aborted");
    if (transitionError) {
      throw new HttpError(422, "INVALID_TRANSITION", transitionError);
    }

    const version = body.version ?? orchestration.version;

    await commands.abortOrchestration(ctx, id, { reason: body.reason, version });

    return reply.status(202).send({
      data: {
        id,
        status: "accepted",
        reason: body.reason,
        version: version + 1,
        correlationId: ctx.correlationId,
      },
    });
  });

  app.get("/v1/ai/orchestrations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);

    const key = cache.makeKey(ctx.tenantId, "orchestration", id);
    const loaded = await cache.getOrLoad(key, async () => {
      const orchestration = await repo.findById(id, ctx.tenantId);
      if (!orchestration) return null;
      const hops = await repo.listHops(id, ctx.tenantId);
      return { orchestration: repo.toView(orchestration), hops: hops.map(repo.toHopView) };
    });

    if (!loaded) {
      throw new HttpError(404, "NOT_FOUND", "orchestration not found");
    }

    return reply.send({
      data: {
        ...loaded.orchestration,
        hops: loaded.hops,
        trace: summarizeHopTrace(loaded.hops),
      },
    });
  });
}
