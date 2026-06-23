import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const ASSET_ROLES = ["asset_manager", "asset_admin", "super_admin"];

export async function verificationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/assets/verifications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const body = z.object({ verificationDate: z.string(), notes: z.string().optional() }).parse(req.body);
    return reply.code(201).send({ data: await commands.createVerification(ctx, {
      verificationDate: body.verificationDate,
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    }) });
  });

  app.post("/v1/assets/verifications/:id/items", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      assetId: z.string().uuid(), condition: z.string(),
      foundAtLocation: z.boolean().optional(), remarks: z.string().optional(),
    }).parse(req.body);
    return reply.code(201).send({ data: await commands.addVerificationItem(ctx, id, {
      assetId: body.assetId,
      condition: body.condition,
      ...(body.foundAtLocation !== undefined ? { foundAtLocation: body.foundAtLocation } : {}),
      ...(body.remarks !== undefined ? { remarks: body.remarks } : {}),
    }) });
  });

  app.post("/v1/assets/verifications/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return reply.send({ data: await commands.submitVerification(ctx, id) });
  });

  app.post("/v1/assets/verifications/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return reply.send({ data: await commands.approveVerification(ctx, id) });
  });

  app.get("/v1/assets/verifications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const rows = await repo.listVerifications(ctx.tenantId);
    return reply.send({ data: rows });
  });

  app.post("/v1/assets/assets/:id/writeoff-request", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ remarks: z.string().optional() }).parse(req.body ?? {});
    return reply.code(201).send({ data: await commands.requestWriteoff(ctx, id, body.remarks) });
  });

  app.post("/v1/assets/writeoff-requests/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return reply.send({ data: await commands.approveWriteoffRequest(ctx, id) });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
