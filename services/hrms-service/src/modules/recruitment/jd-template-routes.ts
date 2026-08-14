import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { createJdTemplateBody, updateJdTemplateBody, idParam } from "./validators.js";
import * as templateRepo from "./jd-template-repo.js";
import * as repo from "./repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];

export async function jdTemplateRoutes(app: FastifyInstance): Promise<void> {
  // List templates (filterable by vacancyType)
  app.get("/v1/hrms/jd-templates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const q = req.query as { vacancyType?: string; limit?: string };
    const opts: { vacancyType?: string; limit?: number } = {
      limit: q.limit ? Math.min(200, Number(q.limit)) : 100,
    };
    if (q.vacancyType) opts.vacancyType = q.vacancyType;
    const rows = await templateRepo.listTemplates(ctx.tenantId, opts);
    return reply.send({ data: rows });
  });

  // Get single template
  app.get("/v1/hrms/jd-templates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const tmpl = await templateRepo.findTemplateById(id, ctx.tenantId);
    if (!tmpl) throw new HttpError(404, "NOT_FOUND", "template not found");
    return reply.send(tmpl);
  });

  // Create template
  app.post("/v1/hrms/jd-templates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = createJdTemplateBody.parse(req.body);
    const id = randomUUID();
    await queue.publish(COMMANDS.jdTemplateCreate, {
      messageId: id, type: COMMANDS.jdTemplateCreate,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, ...body },
    });
    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId });
  });

  // Update template
  app.patch("/v1/hrms/jd-templates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const tmpl = await templateRepo.findTemplateById(id, ctx.tenantId);
    if (!tmpl) throw new HttpError(404, "NOT_FOUND", "template not found");
    const body = updateJdTemplateBody.parse(req.body);
    await queue.publish(COMMANDS.jdTemplateUpdate, {
      messageId: randomUUID(), type: COMMANDS.jdTemplateUpdate,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, ...body },
    });
    return reply.send({ id, status: "accepted", correlationId: ctx.correlationId });
  });

  // Archive template (soft-delete)
  app.delete("/v1/hrms/jd-templates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const tmpl = await templateRepo.findTemplateById(id, ctx.tenantId);
    if (!tmpl) throw new HttpError(404, "NOT_FOUND", "template not found");
    await queue.publish(COMMANDS.jdTemplateArchive, {
      messageId: randomUUID(), type: COMMANDS.jdTemplateArchive,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId },
    });
    return reply.send({ id, status: "archived" });
  });

  // Create job opening from template (pre-fills fields, HR can override later)
  app.post("/v1/hrms/jd-templates/:id/use", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id: templateId } = idParam.parse(req.params);
    const tmpl = await templateRepo.findTemplateById(templateId, ctx.tenantId);
    if (!tmpl || tmpl.isArchived) throw new HttpError(404, "NOT_FOUND", "template not found");

    const overrides = (req.body as Record<string, unknown>) ?? {};
    const jobId = randomUUID();

    // Merge template defaults with caller-supplied overrides
    const payload = {
      id: jobId,
      tenantId: ctx.tenantId,
      templateId,
      refNo: (overrides.refNo as string | undefined) ?? `JD/${new Date().getFullYear()}/${jobId.slice(-6).toUpperCase()}`,
      title: (overrides.title as string | undefined) ?? tmpl.name,
      departmentId: overrides.departmentId as string,
      vacancies: (overrides.vacancies as number | undefined) ?? 1,
      vacancyType: tmpl.vacancyType,
      description: (overrides.description as string | undefined) ?? tmpl.description,
      qualification: (overrides.qualification as string | undefined) ?? tmpl.qualification,
      payRange: (overrides.payRange as string | undefined) ?? tmpl.payRange,
      selectionProcess: (overrides.selectionProcess as string | undefined) ?? tmpl.selectionProcess,
      eligibility: (overrides.eligibility as Record<string, unknown> | undefined) ?? tmpl.eligibility,
      closesAt: overrides.closesAt as string | undefined,
      isPublished: false,
    };

    if (!payload.departmentId) throw new HttpError(400, "MISSING_FIELD", "departmentId is required");

    await queue.publish(COMMANDS.jobCreate, {
      messageId: jobId, type: COMMANDS.jobCreate,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload,
    });

    // Increment useCount asynchronously (fire-and-forget)
    void templateRepo.incrementUseCount(ctx.tenantId, templateId);

    return reply.code(202).send({ id: jobId, status: "accepted", templateId, correlationId: ctx.correlationId });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "jd-template route error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
