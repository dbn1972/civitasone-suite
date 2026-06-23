import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

const REPORT_ROLES = ["report_viewer", "report_admin", "finance_admin", "super_admin", "admin"];

interface ScheduledReport {
  id: string;
  tenantId: string;
  reportName: string;
  cronExpr: string;
  recipients: string[];
  format: "pdf" | "xlsx" | "csv";
  parameters: Record<string, unknown>;
  active: boolean;
  lastRunAt: string | null;
  createdBy: string;
  createdAt: string;
}

interface GeneratedReport {
  id: string;
  scheduledId: string;
  tenantId: string;
  status: "queued" | "running" | "completed" | "failed";
  triggeredBy: string;
  triggeredAt: string;
  completedAt: string | null;
}

const scheduleStore: ScheduledReport[] = [];
const generatedStore: GeneratedReport[] = [];

const scheduleBody = z.object({
  reportName: z.string().min(1).max(255),
  cronExpr: z.string().min(1).max(100),
  recipients: z.array(z.string().email()).min(1).max(20),
  format: z.enum(["pdf", "xlsx", "csv"]).default("pdf"),
  parameters: z.record(z.unknown()).default({}),
});

export async function scheduledRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/reports/schedule", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REPORT_ROLES);
    const body = scheduleBody.parse(req.body);

    const record: ScheduledReport = {
      id: crypto.randomUUID(),
      tenantId: ctx.tenantId,
      reportName: body.reportName,
      cronExpr: body.cronExpr,
      recipients: body.recipients,
      format: body.format,
      parameters: body.parameters,
      active: true,
      lastRunAt: null,
      createdBy: ctx.actorId,
      createdAt: new Date().toISOString(),
    };
    scheduleStore.push(record);
    return reply.code(201).send({ data: record });
  });

  app.get("/v1/reports/schedules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REPORT_ROLES);
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const rows = scheduleStore.filter((r) => r.tenantId === ctx.tenantId && r.active);
    return reply.send({ data: rows.slice(q.offset, q.offset + q.limit), total: rows.length });
  });

  app.get("/v1/reports/scheduled", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REPORT_ROLES);
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const rows = scheduleStore.filter((r) => r.tenantId === ctx.tenantId && r.active);
    return reply.send({ data: rows.slice(q.offset, q.offset + q.limit), total: rows.length });
  });

  app.post("/v1/reports/generate/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REPORT_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const schedule = scheduleStore.find((r) => r.id === id && r.tenantId === ctx.tenantId);
    if (!schedule) throw new HttpError(404, "NOT_FOUND", "scheduled report not found");

    const generated: GeneratedReport = {
      id: crypto.randomUUID(),
      scheduledId: id,
      tenantId: ctx.tenantId,
      status: "queued",
      triggeredBy: ctx.actorId,
      triggeredAt: new Date().toISOString(),
      completedAt: null,
    };
    generatedStore.push(generated);

    // Update last run time
    schedule.lastRunAt = new Date().toISOString();

    return reply.code(201).send({ data: generated });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
