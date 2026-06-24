import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import { RiskSummaryListSchema } from "@civitasone/schemas/web";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createRiskBody, updateRiskBody, linkRisksBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const AUDIT_ROLES = ["audit_officer", "audit_admin", "super_admin"];
const READER_ROLES = [...AUDIT_ROLES, "finance_admin"];

export async function riskRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/audit/risks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AUDIT_ROLES);
    const body = createRiskBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createRisk(ctx, body));
  });

  app.patch("/v1/audit/risks/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AUDIT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateRiskBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateRisk(ctx, id, body));
  });

  // NOTE: GET /v1/audit/risks (list) is served by admin/routes.ts to avoid a duplicate route.

  // P1-7: audit universe — high-risk entities that should drive the audit plan.
  app.get("/v1/audit/risks/universe", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, RiskSummaryListSchema, await queries.listAuditUniverse(ctx.tenantId, q.limit));
  });

  // P1-7: select high-risk entities into a plan (risk-driven planning).
  app.post("/v1/audit/plans/:id/risks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AUDIT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = linkRisksBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.linkRisksToPlan(ctx, id, body));
  });

  app.get("/v1/audit/plans/:id/risks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    sendValidated(reply, RiskSummaryListSchema, await queries.listPlanRisks(ctx.tenantId, id));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
