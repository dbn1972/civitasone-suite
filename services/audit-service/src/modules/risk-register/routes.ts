import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import {
  idParam, acceptanceIdParam, createControlBody, testControlBody, createIncidentBody,
  createMitigationBody, proposeAcceptanceBody, decideAcceptanceBody, reviewRiskBody,
} from "./validators.js";

const AUDIT_ROLES = ["audit_officer", "audit_admin", "super_admin"];
const READER_ROLES = [...AUDIT_ROLES, "finance_admin"];
// Maker-checker: a risk acceptance is approved only by an authority.
const AUTHORITY_ROLES = ["audit_admin", "super_admin"];

export async function riskRegisterRoutes(app: FastifyInstance): Promise<void> {
  // ── controls ──────────────────────────────────────────────────────────
  app.post("/v1/audit/risk-controls", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, AUDIT_ROLES);
    const body = createControlBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createControl(ctx, body));
  });
  app.post("/v1/audit/risk-controls/:id/tests", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, AUDIT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = testControlBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.testControl(ctx, id, body));
  });
  app.get("/v1/audit/risks/:id/controls", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(await queries.listControls(ctx.tenantId, id));
  });

  // ── incidents ─────────────────────────────────────────────────────────
  app.post("/v1/audit/risk-incidents", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, AUDIT_ROLES);
    const body = createIncidentBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createIncident(ctx, body));
  });
  app.get("/v1/audit/risk-incidents", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    return reply.send(await queries.listIncidents(ctx.tenantId, q.limit));
  });

  // ── mitigation plans ────────────────────────────────────────────────────
  app.post("/v1/audit/risk-mitigations", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, AUDIT_ROLES);
    const body = createMitigationBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createMitigation(ctx, body));
  });
  app.get("/v1/audit/risks/:id/mitigations", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(await queries.listMitigations(ctx.tenantId, id));
  });

  // ── risk acceptance (maker-checker) ─────────────────────────────────────
  app.post("/v1/audit/risk-acceptances", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, AUDIT_ROLES);
    const body = proposeAcceptanceBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.proposeAcceptance(ctx, body));
  });
  app.patch("/v1/audit/risk-acceptances/:id/decision", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, AUTHORITY_ROLES);
    const { id } = acceptanceIdParam.parse(req.params);
    const body = decideAcceptanceBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.decideAcceptance(ctx, id, body));
  });
  app.get("/v1/audit/risks/:id/acceptances", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(await queries.listAcceptances(ctx.tenantId, id));
  });

  // ── periodic review cycle ───────────────────────────────────────────────
  app.post("/v1/audit/risk-reviews", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, AUDIT_ROLES);
    const body = reviewRiskBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.reviewRisk(ctx, body));
  });
  app.get("/v1/audit/risks/:id/reviews", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(await queries.listReviews(ctx.tenantId, id));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
