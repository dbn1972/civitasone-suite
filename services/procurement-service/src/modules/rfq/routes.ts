import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import { RFQSummaryListSchema, RFQDetailSchema } from "@civitasone/schemas/web";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createRfqBody, rfqRespondBody, awardRfqBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const PROC_ROLES   = ["procurement_officer", "procurement_admin", "super_admin"];
const READER_ROLES = [...PROC_ROLES, "audit_officer", "finance_officer"];
const idParam      = z.object({ id: z.string().uuid() });
const VENDOR_ROLES = ["vendor", ...PROC_ROLES];

export async function rfqRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/procurement/rfqs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const body = createRfqBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createRfq(ctx, body));
  });

  app.get("/v1/procurement/rfqs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, RFQSummaryListSchema, await queries.listRfqs(ctx.tenantId, q.limit, q.offset));
  });

  app.get("/v1/procurement/rfqs/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const detail = await queries.getRfqDetail(id, ctx.tenantId);
    if (!detail) throw new HttpError(404, "NOT_FOUND", "RFQ not found");
    sendValidated(reply, RFQDetailSchema, detail);
  });


  app.post("/v1/procurement/rfqs/:id/respond", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VENDOR_ROLES);
    const { id } = idParam.parse(req.params);
    const detail = await queries.getRfqDetail(id, ctx.tenantId);
    if (!detail) throw new HttpError(404, "NOT_FOUND", "RFQ not found");
    // DOM-011: an RFQ only accepts responses while 'issued' -- reject
    // synchronously with 409 instead of silently queuing a response the
    // consumer will just drop (see rfq/consumer.ts's rfqRespond handler).
    if (detail.status !== "issued") {
      throw new HttpError(409, "RFQ_NOT_OPEN", `RFQ is '${detail.status}', not open for responses`);
    }
    const body = rfqRespondBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.respondToRfq(ctx, id, body));
  });

  // DOM-011: close/award lifecycle (previously nonexistent -- an RFQ could
  // only ever be 'issued' and then sat there forever). PROC_ROLES-gated,
  // matching create/respond's own role convention for this module.
  app.post("/v1/procurement/rfqs/:id/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.closeRfq(ctx, id));
  });

  app.post("/v1/procurement/rfqs/:id/award", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
    const body = awardRfqBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.awardRfq(ctx, id, body));
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
