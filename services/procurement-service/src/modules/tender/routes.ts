import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { TenderSummaryListSchema, TenderDetailSchema } from "@civitasone/schemas/web";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as queries from "./queries.js";
import * as commands from "./commands.js";
import { createTenderBody, submitBidBody, techEvaluateBody, idParam } from "./validators.js";

const PROC_ROLES   = ["procurement_officer", "procurement_admin", "super_admin"];
const READER_ROLES = [...PROC_ROLES, "audit_officer", "finance_officer"];

export async function tenderRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/procurement/tenders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, TenderSummaryListSchema, await queries.listTenders(ctx.tenantId, q.limit, q.offset));
  });

  app.get("/v1/procurement/tenders/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const detail = await queries.getTenderDetail(id, ctx.tenantId);
    if (!detail) throw new HttpError(404, "NOT_FOUND", "tender not found");
    sendValidated(reply, TenderDetailSchema, detail);
  });

  // Two-bid evaluation view — proves the sealing property (financial withheld
  // until the envelope is opened).
  app.get("/v1/procurement/tenders/:id/evaluation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const view = await queries.getEvaluationView(id, ctx.tenantId);
    if (!view) throw new HttpError(404, "NOT_FOUND", "tender not found");
    return reply.send(view);
  });

  // ── Competitive lifecycle commands ──────────────────────────────────────
  app.post("/v1/procurement/tenders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const body = createTenderBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createTender(ctx, body));
  });

  app.post("/v1/procurement/tenders/:id/publish", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.publishTender(ctx, id));
  });

  app.post("/v1/procurement/tenders/:id/bids", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
    const body = submitBidBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitBid(ctx, id, body));
  });

  app.post("/v1/procurement/tenders/:id/technical-evaluation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
    const body = techEvaluateBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.technicalEvaluate(ctx, id, body));
  });

  app.post("/v1/procurement/tenders/:id/open-financial", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.openFinancials(ctx, id));
  });

  app.post("/v1/procurement/tenders/:id/award", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.awardTender(ctx, id));
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
