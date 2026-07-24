/**
 * Condemnation routes — survey, committee recommendation, auction (SVC-060).
 * Maker-checker enforced on recommendation approval.
 */
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  idParam, createSurveyBody, submitSurveyBody, createRecommendationBody,
  approveRecommendationBody, createAuctionBody, completeAuctionBody,
} from "./validators.js";
import * as commands from "./commands.js";

const ASSET_ROLES = ["asset_manager", "asset_admin", "super_admin"];
const AUDIT_ROLES = [...ASSET_ROLES, "audit_officer"];

export async function condemnationRoutes(app: FastifyInstance): Promise<void> {
  // ── Condemnation Survey ────────────────────────────────────────────────
  app.post("/v1/assets/condemnation-surveys", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const body = createSurveyBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createSurvey(ctx, body));
  });

  app.patch("/v1/assets/condemnation-surveys/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = idParam.parse(req.params);
    const body = submitSurveyBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitSurvey(ctx, id, body));
  });

  // ── Committee Recommendation ───────────────────────────────────────────
  app.post("/v1/assets/condemnation-recommendations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const body = createRecommendationBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createRecommendation(ctx, body));
  });

  app.patch("/v1/assets/condemnation-recommendations/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = idParam.parse(req.params);
    const body = approveRecommendationBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.approveRecommendation(ctx, id, body));
  });

  // ── Auction ────────────────────────────────────────────────────────────
  app.post("/v1/assets/auctions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const body = createAuctionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createAuction(ctx, body));
  });

  app.patch("/v1/assets/auctions/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = idParam.parse(req.params);
    const body = completeAuctionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.completeAuction(ctx, id, body));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
