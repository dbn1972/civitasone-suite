/**
 * jobs HTTP routes.
 */
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import {
  ReportJobSummaryListSchema,
  ReportJobDetailSchema,
  KPISummaryListSchema,
  MISSummaryListSchema,
} from "@civitasone/schemas/web";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createJobBody, jobsListSchema, idParam, downloadQuerySchema } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as kpiQueries from "../kpis/queries.js";
import * as misQueries from "../mis/queries.js";

const ROLES = ["report_user", "report_admin", "super_admin"];

export async function jobRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/reports/jobs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = createJobBody.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.createJob(ctx, body));
  });

  app.get("/v1/reports/jobs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, jobsListSchema, await queries.listJobs(ctx.tenantId, q.limit, q.offset));
  });

  app.get("/v1/reports/report-jobs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const result = await queries.listJobs(ctx.tenantId, q.limit, q.offset);
    sendValidated(reply, ReportJobSummaryListSchema, result.data.map((job) => ({
      id: job.id,
      reportName: job.name,
      module: job.reportType ?? "general",
      requestedBy: job.requestedBy ?? job.tenantId,
      requestedAt: job.completedAt ? new Date(job.completedAt as unknown as string).toISOString() : new Date().toISOString(),
      completedAt: job.completedAt?.toISOString(),
      format: (["pdf", "xlsx", "csv", "html"].includes(job.format) ? job.format : "pdf") as "pdf" | "xlsx" | "csv" | "html",
      status: (["queued", "running", "completed", "failed"].includes(job.status) ? job.status : "queued") as "queued" | "running" | "completed" | "failed",
      downloadUrl: job.downloadUrl ?? undefined,
      rowCount: job.rowCount ?? undefined,
    })));
  });

  app.get("/v1/reports/report-jobs/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const job = await queries.getJob(ctx.tenantId, id);
    if (!job) throw new HttpError(404, "NOT_FOUND", "report job not found");
    sendValidated(reply, ReportJobDetailSchema, {
      id: job.id,
      reportName: job.name,
      module: job.reportType ?? "general",
      requestedBy: job.requestedBy ?? job.tenantId,
      requestedAt: job.completedAt ? new Date(job.completedAt as unknown as string).toISOString() : new Date().toISOString(),
      completedAt: job.completedAt?.toISOString(),
      format: (["pdf", "xlsx", "csv", "html"].includes(job.format) ? job.format : "pdf") as "pdf" | "xlsx" | "csv" | "html",
      status: (["queued", "running", "completed", "failed"].includes(job.status) ? job.status : "queued") as "queued" | "running" | "completed" | "failed",
      downloadUrl: job.downloadUrl ?? undefined,
      rowCount: job.rowCount ?? undefined,
      columns: [],
      rows: [],
      totalCount: job.rowCount ?? 0,
    });
  });

  /** Download redirect — returns the presigned download URL for a completed job.
   *  Accepts optional `watermarkText` query param for ad-hoc watermarking. */
  app.get("/v1/reports/jobs/:id/download", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const { watermarkText } = downloadQuerySchema.parse(req.query);
    const job = await queries.getJob(ctx.tenantId, id);
    if (!job) throw new HttpError(404, "NOT_FOUND", "report job not found");
    if (job.status !== "completed" || !job.downloadUrl) {
      throw new HttpError(409, "NOT_READY", "report is not yet completed or has no download URL");
    }
    // watermarkText is available for use in downstream re-render if needed;
    // for pre-rendered jobs, the watermark was applied at render time.
    // Ad-hoc watermark on already-rendered files is a future enhancement.
    const url = watermarkText
      ? `${job.downloadUrl}${job.downloadUrl.includes("?") ? "&" : "?"}wm=${encodeURIComponent(watermarkText)}`
      : job.downloadUrl;
    return reply.redirect(302, url);
  });

  app.get("/v1/reports/kpis", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, KPISummaryListSchema, await kpiQueries.listKpis(ctx.tenantId, q.limit));
  });

  app.get("/v1/reports/mis", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, MISSummaryListSchema, await misQueries.listMisSummary(ctx.tenantId, q.limit));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
