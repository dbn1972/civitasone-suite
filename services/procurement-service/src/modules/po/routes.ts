import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { posListResponseSchema } from "@civitasone/schemas/web";
import {sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createPoBody, gemOrderBody, dispatchBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const PROC_ROLES   = ["procurement_officer", "procurement_admin", "super_admin"];
const READER_ROLES = [...PROC_ROLES, "audit_officer", "finance_officer"];

export async function poRoutes(app: FastifyInstance): Promise<void> {
  // Alias: /v1/procurement/orders → same handler as /v1/procurement/pos
  app.get("/v1/procurement/orders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, posListResponseSchema, await queries.listPos(ctx.tenantId, q.limit, q.offset));
  });

  // Alias: /v1/procurement/purchase-orders → same as /pos (UAT compat)
  app.get("/v1/procurement/purchase-orders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, posListResponseSchema, await queries.listPos(ctx.tenantId, q.limit, q.offset));
  });

  app.get("/v1/procurement/pos", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, posListResponseSchema, await queries.listPos(ctx.tenantId, q.limit, q.offset));
  });

  app.post("/v1/procurement/pos", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const body = createPoBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createPo(ctx, body));
  });

  app.patch("/v1/procurement/pos/:id/dispatch", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
    const body = dispatchBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.dispatchPo(ctx, id, body));
  });

  // Submit a PO to eOffice for administrative approval. The eFile is raised via
  // the eOffice integration; the decision returns on procurement.po.file_decided
  // and moves the PO to approved/cancelled.
  app.post("/v1/procurement/pos/:id/submit-approval", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitPoForApproval(ctx, id));
  });

  app.post("/v1/procurement/pos/gem", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const body = gemOrderBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createGemOrder(ctx, body));
  });

  app.get("/v1/procurement/pos/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const po = await queries.getPo(id, ctx.tenantId);
    if (!po) throw new HttpError(404, "NOT_FOUND", "purchase order not found");
    return reply.send(po);
  });


  // Alias: POST /v1/procurement/purchase-orders -> same as POST /pos (REST compat)
  app.post("/v1/procurement/purchase-orders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const body = createPoBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createPo(ctx, body));
  });

  // Alias: GET /v1/procurement/purchase-orders/:id -> same as GET /pos/:id (REST compat)
  app.get("/v1/procurement/purchase-orders/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const po = await queries.getPo(id, ctx.tenantId);
    if (!po) throw new HttpError(404, "NOT_FOUND", "purchase order not found");
    return reply.send(po);
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
