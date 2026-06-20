import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createDepScheduleBody, runDepBody, assetIdParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ASSET_ROLES  = ["asset_manager", "asset_admin", "super_admin", "finance_officer"];
const READER_ROLES = [...ASSET_ROLES, "audit_officer"];

export async function depRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/assets/:id/depreciation/schedule", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = assetIdParam.parse(req.params);
    const body = createDepScheduleBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createDepSchedule(ctx, id, body));
  });

  app.post("/v1/assets/depreciation/run", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const body = runDepBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.runDepreciation(ctx, body));
  });

  app.get("/v1/assets/:id/depreciation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = assetIdParam.parse(req.params);
    const schedule = await queries.getDepSchedule(ctx.tenantId, id);
    const entries  = await queries.getDepEntries(ctx.tenantId, id);
    return reply.send({ schedule, entries });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
