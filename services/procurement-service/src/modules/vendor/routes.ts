import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { vendorListResponseSchema } from "@civitasone/schemas/web";
import {sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createVendorBody, empanelBody, blacklistBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const PROC_ROLES   = ["procurement_officer", "procurement_admin", "super_admin"];
const READER_ROLES = [...PROC_ROLES, "audit_officer"];

export async function vendorRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/procurement/vendors", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, vendorListResponseSchema, await queries.listVendors(ctx.tenantId, q.limit));
  });

  app.post("/v1/procurement/vendors", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const body = createVendorBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createVendor(ctx, body));
  });

  app.patch("/v1/procurement/vendors/:id/empanel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
    const body = empanelBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.empanelVendor(ctx, id, body));
  });

  app.patch("/v1/procurement/vendors/:id/blacklist", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
    const body = blacklistBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.blacklistVendor(ctx, id, body));
  });

  app.get("/v1/procurement/vendors/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const vendor = await queries.getVendor(id, ctx.tenantId);
    if (!vendor) throw new HttpError(404, "NOT_FOUND", "vendor not found");
    return reply.send(vendor);
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
