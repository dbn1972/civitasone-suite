import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import { GRNSummaryListSchema } from "@civitasone/schemas/web";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createGrnBody, idParam, acceptGrnBody, rejectGrnBody, amendGrnBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const PROC_ROLES   = ["procurement_officer", "procurement_admin", "super_admin", "store_officer"];
const READER_ROLES = [...PROC_ROLES, "audit_officer", "finance_officer"];
const WAREHOUSE_ROLES = ["warehouse_officer", "procurement_admin", "super_admin"];

export async function grnRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/procurement/grns", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, GRNSummaryListSchema, await queries.listGrns(ctx.tenantId, q.limit, q.offset));
  });

  app.post("/v1/procurement/grns", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const body = createGrnBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createGrn(ctx, body));
  });

  app.get("/v1/procurement/grns/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const grn = await queries.getGrn(id, ctx.tenantId);
    if (!grn) throw new HttpError(404, "NOT_FOUND", "GRN not found");
    return reply.send(grn);
  });


  // DOM-002 — the real inspection "pass" step. inspectorId is NOT part of
  // the request body: commands.acceptGrn derives it from ctx.actorId (this
  // call's own authenticated identity) and rejects with 403 SOD_VIOLATION if
  // it matches the GRN's creator, and with 409 GRN_NOT_INSPECTABLE if the
  // GRN isn't awaiting inspection. Requires a distinct, independently
  // authenticated request from whoever created the GRN.
  app.patch("/v1/procurement/grns/:id/accept", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WAREHOUSE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = acceptGrnBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.acceptGrn(ctx, id, body));
  });

  // DOM-002 — the real inspection "fail" step. Same identity rule as accept.
  app.patch("/v1/procurement/grns/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WAREHOUSE_ROLES);
    const { id } = idParam.parse(req.params);
    const { reason } = rejectGrnBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.rejectGrn(ctx, id, reason));
  });

  // Req 1.2 — GRN partial-delivery amendment. Only permitted while the GRN is
  // `draft` or `under_inspection`; commands.amendGrn returns 409
  // GRN_NOT_AMENDABLE otherwise (checked synchronously, not deferred to the
  // consumer, so the caller gets an immediate answer).
  app.patch("/v1/procurement/grns/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
    const body = amendGrnBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.amendGrn(ctx, id, body));
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
