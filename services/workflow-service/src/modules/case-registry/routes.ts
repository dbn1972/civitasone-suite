import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import * as repo from "./repo.js";

const ADMIN = ["super_admin", "workflow_admin", "case_manager"];

export async function caseRegistryRoutes(app: FastifyInstance): Promise<void> {
  // List cases (cross-service unified registry)
  app.get("/v1/workflow/cases", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const data = await repo.listCases(ctx.tenantId);
    return reply.send({ data, meta: { total: data.length } });
  });

  // Get single case with children
  app.get("/v1/workflow/cases/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const c = await repo.findCase(ctx.tenantId, id);
    if (!c) throw new HttpError(404, "NOT_FOUND", "Case not found");
    const children = await repo.findChildren(ctx.tenantId, id);
    return reply.send({ data: { ...c, children } });
  });

  // Register a new case (from any service)
  app.post("/v1/workflow/cases", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({ title: z.string().min(1).max(256), caseType: z.string().min(1).max(64), sourceService: z.string().min(1), sourceRefId: z.string().uuid(), priority: z.enum(["critical", "high", "normal", "low"]).default("normal"), metadata: z.record(z.unknown()).default({}) }).parse(req.body);
    const id = randomUUID();
    await queue.publish("workflow.case.create", { messageId: id, type: "workflow.case.create", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, tenantId: ctx.tenantId, caseNumber: `CASE-${Date.now()}`, ...body } });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  // Split a case into sub-cases
  app.post("/v1/workflow/cases/:id/split", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ subCases: z.array(z.object({ title: z.string(), caseType: z.string(), assigneeId: z.string().uuid().optional() })).min(2).max(10) }).parse(req.body);
    const existing = await repo.findCase(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Case not found");
    const splitId = randomUUID();
    await queue.publish("workflow.case.split", { messageId: splitId, type: "workflow.case.split", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { parentCaseId: id, subCases: body.subCases.map(sc => ({ ...sc, id: randomUUID() })) } });
    return reply.code(202).send({ data: { parentCaseId: id, subCaseCount: body.subCases.length, status: "splitting" } });
  });

  // Merge cases
  app.post("/v1/workflow/cases/merge", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({ caseIds: z.array(z.string().uuid()).min(2).max(20), targetCaseId: z.string().uuid(), reason: z.string().min(1).max(500) }).parse(req.body);
    await queue.publish("workflow.case.merge", { messageId: randomUUID(), type: "workflow.case.merge", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { ...body } });
    return reply.code(202).send({ data: { targetCaseId: body.targetCaseId, mergedCount: body.caseIds.length, status: "merging" } });
  });

  // Record a deviation
  app.post("/v1/workflow/cases/:id/deviations", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ type: z.enum(["sla_breach", "process_skip", "unauthorized_action", "data_anomaly"]), description: z.string().min(1).max(2000), severity: z.enum(["critical", "high", "medium", "low"]).default("medium") }).parse(req.body);
    const devId = randomUUID();
    await queue.publish("workflow.case.deviation", { messageId: devId, type: "workflow.case.deviation", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id: devId, caseId: id, tenantId: ctx.tenantId, ...body } });
    return reply.code(202).send({ data: { deviationId: devId, status: "recorded" } });
  });

  // List deviations for a case
  app.get("/v1/workflow/cases/:id/deviations", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const deviations = await repo.listDeviations(ctx.tenantId, id);
    return reply.send({ data: deviations, meta: { total: deviations.length } });
  });

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
