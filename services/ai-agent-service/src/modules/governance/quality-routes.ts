import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { READ_ROLES, GOVERNANCE_ROLES } from "../../shared/roles.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./quality-repo.js";
import { computeOverall, summarizeQuality } from "./quality-domain.js";

const score = z.number().min(0).max(1);

const scoreBody = z.object({
  relevance: score,
  coherence: score,
  safety: score,
});

const turnParams = z.object({
  conversationId: z.string().uuid(),
  turnId: z.string().uuid(),
});

const conversationParams = z.object({ conversationId: z.string().uuid() });

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function qualityRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/ai/quality/flagged — human review queue (AG-004).
  // Registered before the /:conversationId route so "flagged" is never read as an id.
  app.get("/v1/ai/quality/flagged", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GOVERNANCE_ROLES);
    const q = listQuery.parse(req.query);

    const key = cache.makeKey(ctx.tenantId, "quality-flagged", `${q.limit}:${q.offset}`);
    const loaded = await cache.getOrLoad(key, async () => {
      const { rows, total } = await repo.listFlagged(ctx.tenantId, q.limit, q.offset);
      return { data: rows.map(repo.toView), total };
    });

    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({
      data: loaded?.data ?? [],
      meta: { page, pageSize: q.limit, total: loaded?.total ?? 0 },
    });
  });

  // PUT /v1/ai/quality/:conversationId/:turnId — upsert a turn score (AG-004)
  app.put("/v1/ai/quality/:conversationId/:turnId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { conversationId, turnId } = turnParams.parse(req.params);
    const body = scoreBody.parse(req.body);

    const computed = computeOverall(body);
    const id = randomUUID();

    await db.transaction(async (tx) => {
      await repo.upsert(tx, {
        id,
        tenantId: ctx.tenantId,
        conversationId,
        turnId,
        relevance: computed.relevance,
        coherence: computed.coherence,
        safety: computed.safety,
        overall: computed.overall,
        flagged: computed.flagged,
        flagReason: computed.flagReason,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.interactionScored,
        eventType: EVENTS.interactionScored,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          conversationId,
          turnId,
          overall: computed.overall,
          flagged: computed.flagged,
        },
      });

      if (computed.flagged) {
        await enqueue(tx, {
          topic: EVENTS.interactionFlagged,
          eventType: EVENTS.interactionFlagged,
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          correlationId: ctx.correlationId,
          payload: { conversationId, turnId, flagReason: computed.flagReason },
        });
      }

      // Scores and ids only — never the turn content (DPDP Act 2023).
      await writeAudit(tx, ctx, {
        action: "quality.score",
        input: null,
        output: computed.overall,
        blocked: false,
        reason: computed.flagReason,
      });
    });

    await cache.invalidateResource(ctx.tenantId, "quality-flagged");
    await cache.invalidateResource(ctx.tenantId, "quality-conversation");

    return reply.status(202).send({
      data: {
        conversationId,
        turnId,
        relevance: computed.relevance,
        coherence: computed.coherence,
        safety: computed.safety,
        overall: computed.overall,
        flagged: computed.flagged,
        flagReason: computed.flagReason,
      },
    });
  });

  // GET /v1/ai/quality/:conversationId — all turn scores for a conversation (AG-004)
  app.get("/v1/ai/quality/:conversationId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GOVERNANCE_ROLES);
    const { conversationId } = conversationParams.parse(req.params);
    const q = listQuery.parse(req.query);

    const key = cache.makeKey(
      ctx.tenantId,
      "quality-conversation",
      `${conversationId}:${q.limit}:${q.offset}`,
    );
    const loaded = await cache.getOrLoad(key, async () => {
      const { rows, total } = await repo.listByConversation(ctx.tenantId, conversationId, q.limit, q.offset);
      return { data: rows.map(repo.toView), total };
    });

    const rows = loaded?.data ?? [];
    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({
      data: rows,
      meta: { page, pageSize: q.limit, total: loaded?.total ?? 0 },
      summary: summarizeQuality(rows),
    });
  });
}
