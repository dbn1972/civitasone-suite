import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as commands from "./scorecard-commands.js";
import * as repo from "./scorecard-repo.js";
import {
  recomputeScorecardBody, issueShowCauseBody, respondShowCauseBody,
  appealShowCauseBody, decideShowCauseBody, vendorIdParam, showCauseIdParam,
} from "./scorecard-validators.js";

const WRITE_ROLES   = ["procurement_officer", "procurement_admin", "super_admin"];
const APPROVE_ROLES = ["procurement_admin", "super_admin"];
const READER_ROLES  = [...WRITE_ROLES, "audit_officer", "finance_officer"];

export async function vendorScorecardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/procurement/vendors/:vendorId/scorecard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { vendorId } = vendorIdParam.parse(req.params);
    const sc = await repo.findScorecard(vendorId, ctx.tenantId);
    if (!sc) return reply.send({ data: { vendorId, ratingBand: "unrated", overallRating: 0, totalOrders: 0 } });
    return reply.send({ data: sc });
  });

  app.post("/v1/procurement/vendors/:vendorId/scorecard/recompute", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { vendorId } = vendorIdParam.parse(req.params);
    const body = recomputeScorecardBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.recomputeScorecard(ctx, vendorId, body));
  });

  // ── Show-cause ──────────────────────────────────────────────────
  app.post("/v1/procurement/vendors/:vendorId/show-cause", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { vendorId } = vendorIdParam.parse(req.params);
    const body = issueShowCauseBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.issueShowCause(ctx, vendorId, body));
  });

  app.get("/v1/procurement/vendors/:vendorId/show-cause", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { vendorId } = vendorIdParam.parse(req.params);
    const rows = await repo.listShowCauseByVendor(vendorId, ctx.tenantId);
    return reply.send({ data: rows });
  });

  app.patch("/v1/procurement/show-cause/:id/respond", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = showCauseIdParam.parse(req.params);
    const body = respondShowCauseBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.respondShowCause(ctx, id, body));
  });

  app.patch("/v1/procurement/show-cause/:id/appeal", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = showCauseIdParam.parse(req.params);
    const body = appealShowCauseBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.appealShowCause(ctx, id, body));
  });

  app.patch("/v1/procurement/show-cause/:id/decide", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVE_ROLES);
    const { id } = showCauseIdParam.parse(req.params);
    const body = decideShowCauseBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.decideShowCause(ctx, id, body));
  });

  app.setErrorHandler(errorHandler);
}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
