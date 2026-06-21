import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import {
  AuditObservationSummaryListSchema,
  AuditObservationDetailSchema,
} from "@civitasone/schemas/web";
import { listQuerySchema } from "@civitasone/schemas/common";
import * as queries from "./queries.js";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createObservationBody, draftParaBody, idParam } from "./validators.js";

import * as commands from "./commands.js";

const AUDIT_ROLES = ["audit_officer", "audit_admin", "super_admin"];
const READER_ROLES = [...AUDIT_ROLES, "finance_admin"];

export async function observationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/audit/observations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AUDIT_ROLES);
    const body = createObservationBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createObservation(ctx, body));
  });

  app.post("/v1/audit/observations/:id/draft-para", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AUDIT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = draftParaBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.draftPara(ctx, id, body));
  });

  app.get("/v1/audit/observations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, AuditObservationSummaryListSchema, await queries.listObservationSummaries(ctx.tenantId, q.limit));
  });

  app.get("/v1/audit/observations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const detail = await queries.getObservationDetail(id, ctx.tenantId);
    if (!detail) throw new HttpError(404, "NOT_FOUND", "observation not found");
    sendValidated(reply, AuditObservationDetailSchema, detail);
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
