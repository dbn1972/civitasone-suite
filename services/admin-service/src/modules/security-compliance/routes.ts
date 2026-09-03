import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as incidentRepo from "../security-incident/repo.js";
import { computePosture } from "./posture.js";
import * as commands from "./commands.js";

const ADMIN = ["super_admin", "security_admin", "platform_admin"];

export async function securityComplianceRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/admin/security/vapt/scan", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = z
      .object({
        targetServices: z.array(z.string()).min(1),
        scanType: z.enum(["quick", "full", "compliance"]).default("quick"),
      })
      .parse(req.body);
    const id = randomUUID();
    await queue.publish("admin.vapt.scan", {
      messageId: id,
      type: "admin.vapt.scan",
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, ...body },
    });
    return reply.code(202).send({ data: { scanId: id, status: "queued", type: body.scanType } });
  });

  app.post("/v1/admin/security/vapt/reports", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = z
      .object({
        targetServices: z.array(z.string()).min(1),
        scanType: z.enum(["quick", "full", "compliance"]).default("full"),
        critical: z.number().int().min(0).default(0),
        high: z.number().int().min(0).default(0),
        medium: z.number().int().min(0).default(0),
        low: z.number().int().min(0).default(0),
      })
      .parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.ingestVaptReport(ctx, body));
  });

  app.get("/v1/admin/security/vapt/reports", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const scans = await repo.listScans(ctx.tenantId);
    return reply.send({ data: scans, meta: { total: scans.length } });
  });

  app.get("/v1/admin/security/vapt/reports/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const scan = await repo.findScan(ctx.tenantId, id);
    if (!scan) throw new HttpError(404, "NOT_FOUND", "Scan report not found");
    return reply.send({ data: scan });
  });

  app.post("/v1/admin/security/compliance/controls/seed", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    return sendAccepted(reply, acceptedResponseSchema, await commands.seedComplianceControls(ctx));
  });

  app.post("/v1/admin/security/compliance/controls", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = z
      .object({
        controlKey: z.string().min(1).max(32),
        framework: z.enum(["SOC2", "ISO27001", "DPDP"]),
        title: z.string().min(1).max(256),
        description: z.string().max(4000).optional(),
        owner: z.string().max(128).optional(),
      })
      .parse(req.body);
    // Same uniqueness the DB unique index uq_compliance_controls_key
    // (tenant_id, framework, control_key — migration 0023) enforces. The
    // consumer's insert has no application-level dedup for this command (only
    // the seed command dedupes), so without this pre-check a duplicate
    // silently gets a 202 "accepted" and then fails the async insert on the
    // unique-index violation, with no channel back to the caller.
    const clash = await repo.findControlByKey(ctx.tenantId, body.framework, body.controlKey);
    if (clash) {
      throw new HttpError(409, "CONTROL_KEY_EXISTS", `control '${body.framework}:${body.controlKey}' already exists`);
    }
    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.createComplianceControl(ctx, {
        controlKey: body.controlKey,
        framework: body.framework,
        title: body.title,
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.owner !== undefined ? { owner: body.owner } : {}),
      }),
    );
  });

  app.get("/v1/admin/security/compliance/controls", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { framework } = z.object({ framework: z.enum(["SOC2", "ISO27001", "DPDP"]).optional() }).parse(req.query);
    const rows = await repo.listControls(ctx.tenantId, framework);
    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  app.get("/v1/admin/security/soc2/controls", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const rows = await repo.listControls(ctx.tenantId, "SOC2");
    return reply.send({ data: rows, meta: { total: rows.length, note: "persisted control library (not hardcoded)" } });
  });

  app.patch("/v1/admin/security/compliance/controls/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        status: z.enum(["pass", "fail", "not_tested", "not_applicable"]).optional(),
        owner: z.string().max(128).optional(),
      })
      .parse(req.body);
    const ctrl = await repo.findControl(ctx.tenantId, id);
    if (!ctrl) throw new HttpError(404, "NOT_FOUND", "control not found");
    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.updateComplianceControl(ctx, id, {
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.owner !== undefined ? { owner: body.owner } : {}),
      }),
    );
  });

  app.post("/v1/admin/security/compliance/controls/:id/evidence", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        kind: z.enum(["audit_event", "document", "vapt_report", "note"]),
        reference: z.string().max(512).optional(),
        note: z.string().max(4000).optional(),
      })
      .parse(req.body);
    const ctrl = await repo.findControl(ctx.tenantId, id);
    if (!ctrl) throw new HttpError(404, "NOT_FOUND", "control not found");
    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.attachControlEvidence(ctx, id, {
        kind: body.kind,
        ...(body.reference !== undefined ? { reference: body.reference } : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
      }),
    );
  });

  app.get("/v1/admin/security/compliance/controls/:id/evidence", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const rows = await repo.evidenceFor(ctx.tenantId, id);
    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  app.get("/v1/admin/security/incidents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const incidents = await repo.listIncidents(ctx.tenantId);
    return reply.send({ data: incidents, meta: { total: incidents.length } });
  });

  app.get("/v1/admin/security/posture", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const [controls, scans, incidents] = await Promise.all([
      repo.listControls(ctx.tenantId),
      repo.listScans(ctx.tenantId),
      incidentRepo.listIncidents(ctx.tenantId),
    ]);
    const posture = computePosture(controls);
    const openIncidents = incidents.filter((i) => i.status !== "closed").length;
    return reply.send({
      data: {
        ...posture,
        openIncidents,
        totalVaptScans: scans.length,
        lastVaptScan: scans[0]?.createdAt ?? null,
        openVaptCritical: scans[0]?.critical ?? 0,
      },
    });
  });

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
