import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { policyBody, claimBody } from "./validators.js";
import * as commands from "./commands.js";

const ASSET_ROLES = ["asset_manager", "asset_admin", "super_admin"];

export async function insuranceRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/assets/insurance/policies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const body = policyBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createPolicy(ctx, body));
  });

  app.post("/v1/assets/insurance/claims", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const body = claimBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createClaim(ctx, body));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
