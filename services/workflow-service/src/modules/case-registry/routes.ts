import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import * as repo from "./repo.js";

const ADMIN = ["super_admin", "workflow_admin", "case_manager", "tenant_admin"];

export async function caseRegistryRoutes(app: FastifyInstance): Promise<void> {
  // CAP-031 — list cases (cross-service unified registry; merged cases hidden).
  app.get("/v1/workflow/cases", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const data = await repo.listCases(ctx.tenantId);
    return reply.send({ data, meta: { total: data.length } });
  });

  // CAP-031 — get a single case with its child cases.
  app.get("/v1/workflow/cases/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const c = await repo.findCase(ctx.tenantId, id);
    if (!c) throw new HttpError(404, "NOT_FOUND", "Case not found");
    const children = await repo.findChildren(ctx.tenantId, id);
    return reply.send({ data: { ...c, children } });
  });

  // CAP-031 — register a case from any source service (idempotent by source ref).
  app.post("/v1/workflow/cases", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({
      title: z.string().min(1).max(256),
      caseType: z.string().min(1).max(64),
      sourceService: z.string().min(1).max(64),
      sourceRefId: z.string().uuid(),
      priority: z.enum(["critical", "high", "normal", "low"]).default("normal"),
      metadata: z.record(z.unknown()).default({}),
    }).parse(req.body);
    const res = await repo.registerCase({
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, ...body,
    });
    return reply.code(res.created ? 201 : 200).send({ data: { id: res.id, created: res.created } });
  });

  // CAP-031 — record a deviation observation against a case (simple register;
  // the full waiver-approval lifecycle is the deviations module, CAP-039).
  app.post("/v1/workflow/cases/:id/deviations", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      type: z.enum(["sla_breach", "process_skip", "unauthorized_action", "data_anomaly"]),
      description: z.string().min(1).max(2000),
      severity: z.enum(["critical", "high", "medium", "low"]).default("medium"),
    }).parse(req.body);
    if (!(await repo.findCase(ctx.tenantId, id))) throw new HttpError(404, "NOT_FOUND", "Case not found");
    const devId = randomUUID();
    await queue.publish("workflow.case.deviation", { messageId: devId, type: "workflow.case.deviation", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id: devId, caseId: id, tenantId: ctx.tenantId, ...body } });
    return reply.code(202).send({ data: { deviationId: devId, status: "recorded" } });
  });

  // CAP-031 — deviations recorded against a case.
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
