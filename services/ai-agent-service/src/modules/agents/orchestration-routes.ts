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
import * as agentsRepo from "./repo.js";
import * as repo from "./orchestration-repo.js";
import {
  canHandoff,
  normalizeLimits,
  summarizeHopTrace,
  validateOrchestrationTransition,
} from "./orchestration-domain.js";

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
  // A reason is mandatory: an aborted orchestration must be explainable later.
  reason: z.string().min(1).max(500),
  version: z.number().int().min(1).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function orchestrationRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/ai/orchestrations — start an orchestration (AG-001)
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

    await db.transaction(async (tx) => {
      await repo.insert(tx, {
        id,
        tenantId: ctx.tenantId,
        rootAgentId: body.rootAgentId,
        status: "running",
        depth: 0,
        maxDepth: limits.maxDepth,
        hopCount: 0,
        maxHops: limits.maxHops,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.orchestrationStarted,
        eventType: EVENTS.orchestrationStarted,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { orchestrationId: id, rootAgentId: body.rootAgentId, ...limits },
      });

      await writeAudit(tx, ctx, {
        agentId: body.rootAgentId,
        action: "orchestration.start",
        input: null,
        output: id,
        blocked: false,
        reason: null,
      });
    });

    return reply.status(202).send({
      data: {
        id,
        rootAgentId: body.rootAgentId,
        status: "running",
        depth: 0,
        hopCount: 0,
        maxDepth: limits.maxDepth,
        maxHops: limits.maxHops,
        version: 1,
      },
    });
  });

  // POST /v1/ai/orchestrations/:id/handoff — record a handoff (AG-001)
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
      // The refusal itself is auditable: an agent that keeps hitting the valve is
      // a design problem someone needs to see.
      await db.transaction(async (tx) => {
        await enqueue(tx, {
          topic: EVENTS.orchestrationLimitExceeded,
          eventType: EVENTS.orchestrationLimitExceeded,
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          correlationId: ctx.correlationId,
          payload: {
            orchestrationId: id,
            code: decision.code,
            depth: orchestration.depth,
            hopCount: orchestration.hopCount,
          },
        });

        await writeAudit(tx, ctx, {
          agentId: body.fromAgentId,
          action: "orchestration.handoff",
          input: null,
          output: null,
          blocked: true,
          reason: decision.reason,
        });
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

    await db.transaction(async (tx) => {
      await repo.insertHop(tx, {
        id: hopId,
        tenantId: ctx.tenantId,
        orchestrationId: id,
        fromAgentId: body.fromAgentId,
        toAgentId: body.toAgentId,
        depth: decision.nextDepth,
        reason: body.reason,
      });

      const ok = await repo.update(
        tx,
        id,
        ctx.tenantId,
        { depth: decision.nextDepth, hopCount: decision.nextHopCount, updatedBy: ctx.actorId },
        orchestration.version,
      );
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "orchestration has been modified; retry");
      }

      await enqueue(tx, {
        topic: EVENTS.orchestrationHopRecorded,
        eventType: EVENTS.orchestrationHopRecorded,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          orchestrationId: id,
          hopId,
          fromAgentId: body.fromAgentId,
          toAgentId: body.toAgentId,
          depth: decision.nextDepth,
          hopCount: decision.nextHopCount,
        },
      });

      await writeAudit(tx, ctx, {
        agentId: body.fromAgentId,
        action: "orchestration.handoff",
        input: null,
        output: body.toAgentId,
        blocked: false,
        reason: null,
      });
    });

    return reply.status(202).send({
      data: {
        orchestrationId: id,
        hopId,
        fromAgentId: body.fromAgentId,
        toAgentId: body.toAgentId,
        depth: decision.nextDepth,
        hopCount: decision.nextHopCount,
        status: "handed_off",
        version: orchestration.version + 1,
      },
    });
  });

  // POST /v1/ai/orchestrations/:id/abort — operator kill switch (AG-001)
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

    await db.transaction(async (tx) => {
      const ok = await repo.update(
        tx,
        id,
        ctx.tenantId,
        { status: "aborted", reason: body.reason, completedAt: new Date(), updatedBy: ctx.actorId },
        version,
      );
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "orchestration has been modified; retry with current version");
      }

      await enqueue(tx, {
        topic: EVENTS.orchestrationAborted,
        eventType: EVENTS.orchestrationAborted,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { orchestrationId: id, reason: body.reason },
      });

      await writeAudit(tx, ctx, {
        agentId: orchestration.rootAgentId,
        action: "orchestration.abort",
        input: null,
        output: null,
        blocked: false,
        reason: body.reason,
      });
    });

    return reply.send({
      data: { id, status: "aborted", reason: body.reason, version: version + 1 },
    });
  });

  // GET /v1/ai/orchestrations/:id — state + full hop trace (AG-001)
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
