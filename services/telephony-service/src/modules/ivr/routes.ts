/**
 * IVR routes — batch upsert of IVR hits and read endpoint.
 *
 * POST /v1/telephony/calls/:id/ivr-hits — batch upsert (max 50 total per call)
 * GET  /v1/telephony/calls/:id/ivr-hits — list all IVR hits for a call
 */
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { batchIvrHitsBody, callIdParam } from "./validators.js";
import { MAX_IVR_HITS_PER_CALL } from "./domain.js";
import * as repo from "./repo.js";
import { db } from "../../shared/db.js";
import { tenantTransaction } from "@civitasone/db";
import { randomUUID } from "node:crypto";
import type { IvrHitInsert } from "./schema.js";

const TELEPHONY_ROLES = ["telephony_user", "telephony_supervisor", "telephony_admin", "super_admin"];

export async function ivrRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Batch upsert IVR hits for a call.
   * Enforces max 50 IVR hits per call. Returns 422 if limit would be exceeded.
   */
  app.post("/v1/telephony/calls/:id/ivr-hits", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TELEPHONY_ROLES);
    const { id: callId } = callIdParam.parse(req.params);
    const { hits } = batchIvrHitsBody.parse(req.body);

    const currentCount = await repo.countByCall(ctx.tenantId, callId);
    if (currentCount + hits.length > MAX_IVR_HITS_PER_CALL) {
      throw new HttpError(
        422,
        "IVR_LIMIT_EXCEEDED",
        `Cannot add ${hits.length} hits: call already has ${currentCount}/${MAX_IVR_HITS_PER_CALL} hits`,
      );
    }

    const startOrdinal = await repo.maxOrdinal(ctx.tenantId, callId);
    const rows: IvrHitInsert[] = hits.map((hit, idx) => ({
      id: randomUUID(),
      tenantId: ctx.tenantId,
      callId,
      menuKey: hit.menuKey,
      digit: hit.digit,
      timestamp: new Date(hit.timestamp),
      ordinal: startOrdinal + idx + 1,
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
    }));

    await tenantTransaction(db, ctx.tenantId, async (tx) => {
      await repo.insertBatch(tx as unknown as typeof db, rows);
    });

    return reply.code(201).send({
      data: {
        callId,
        inserted: hits.length,
        totalHits: currentCount + hits.length,
      },
    });
  });

  /**
   * List all IVR hits for a call, ordered by ordinal.
   */
  app.get("/v1/telephony/calls/:id/ivr-hits", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TELEPHONY_ROLES);
    const { id: callId } = callIdParam.parse(req.params);
    const hits = await repo.listByCall(ctx.tenantId, callId);
    return reply.send({ data: hits, meta: { total: hits.length } });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
