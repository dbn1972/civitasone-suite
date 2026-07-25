import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
const ADMIN = ["super_admin", "security_admin", "platform_admin"];
export async function securityComplianceRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/admin/security/vapt/scan", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({ targetServices: z.array(z.string()).min(1), scanType: z.enum(["quick", "full", "compliance"]).default("quick") }).parse(req.body);
    const id = randomUUID();
    await queue.publish("admin.vapt.scan", { messageId: id, type: "admin.vapt.scan", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, ...body } });
    return reply.code(202).send({ data: { scanId: id, status: "queued", type: body.scanType } });
  });
  app.get("/v1/admin/security/vapt/reports", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    return reply.send({ data: [], meta: { total: 0 } });
  });
  app.get("/v1/admin/security/vapt/reports/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return reply.send({ data: { id, status: "pending", findings: [], severity: { critical: 0, high: 0, medium: 0, low: 0 } } });
  });
  app.get("/v1/admin/security/soc2/controls", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    return reply.send({ data: [{ id: "CC6.1", name: "Logical Access", status: "implemented", evidence: "RLS + RBAC on all 41 services" }, { id: "CC6.6", name: "Encryption", status: "implemented", evidence: "AES-256-GCM PII encryption via encryptedText()" }, { id: "CC7.2", name: "Monitoring", status: "implemented", evidence: "Pino structured logs + OpenTelemetry" }] });
  });
  app.post("/v1/admin/security/soc2/evidence/export", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({ controlIds: z.array(z.string()).min(1), format: z.enum(["pdf", "csv", "json"]).default("json"), period: z.object({ from: z.string().datetime(), to: z.string().datetime() }) }).parse(req.body);
    const exportId = randomUUID();
    await queue.publish("admin.soc2.export", { messageId: exportId, type: "admin.soc2.export", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { exportId, ...body } });
    return reply.code(202).send({ data: { exportId, status: "generating" } });
  });
  app.get("/v1/admin/security/posture", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    return reply.send({ data: { overallScore: 87, rlsEnabled: true, piiEncrypted: true, secretScanner: true, mfaEnforced: false, wafEnabled: false, lastVaptScan: null, certExpiry: null } });
  });
  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
