import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import {
  HearingSummaryListSchema,
  CourtOrderSummaryListSchema,
  LegalOpinionSummaryListSchema,
} from "@civitasone/schemas/web";
import * as queries from "./queries.js";
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createHearingBody, adjournBody, recordOrderBody, caseHearingParams } from "./validators.js";
import * as commands from "./commands.js";

const LEGAL_ROLES = ["legal_officer", "legal_admin", "super_admin"];
const READER_ROLES = [...LEGAL_ROLES, "audit_officer"];

export async function hearingRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/legal/cases/:id/hearings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = createHearingBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createHearing(ctx, id, body));
  });

  app.patch("/v1/legal/cases/:id/hearings/:hId/adjourn", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const { id, hId } = caseHearingParams.parse(req.params);
    const body = adjournBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.adjournHearing(ctx, id, hId, body));
  });

  app.post("/v1/legal/cases/:id/orders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = recordOrderBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.recordOrder(ctx, id, body));
  });

  app.get("/v1/legal/hearings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, HearingSummaryListSchema, await queries.listHearingSummaries(ctx.tenantId, q.limit));
  });

  app.get("/v1/legal/court-orders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, CourtOrderSummaryListSchema, await queries.listCourtOrderSummaries(ctx.tenantId, q.limit));
  });

  app.get("/v1/legal/opinions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q2 = listQuerySchema.parse(req.query);
    sendValidated(reply, LegalOpinionSummaryListSchema, await queries.listOpinionSummaries(ctx.tenantId, q2.limit));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
