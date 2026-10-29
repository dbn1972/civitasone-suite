/**
 * jobs HTTP routes.
 */
import { randomUUID } from "node:crypto";
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
import { createJobBody, jobsListSchema, idParam, downloadQuerySchema, shareJobBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as kpiQueries from "../kpis/queries.js";
import * as misQueries from "../mis/queries.js";
import { queue } from "../../shared/infra.js";
import { presignedGetUrl } from "@civitasone/storage";
import { DOWNLOAD_LINK_TTL_SECONDS, jobStorageKey } from "../../shared/download.js";
// GAP2-REPORTS-ROLES-01: single canonical report role vocabulary shared with
// the dashboard and scheduled modules. READ_ROLES gates the GET surfaces,
// WRITE_ROLES the POST surfaces (create/share a job). Previously this file
// used a bare ["report_user","report_admin","super_admin"] that disagreed
// with the scheduled routes' ["report_viewer", ...].
import { REPORT_READ_ROLES as READ_ROLES, REPORT_JOB_WRITE_ROLES as WRITE_ROLES, REPORT_PII_UNMASK_ROLES, isReportAdmin, ownerScope } from "../../shared/roles.js";
import type { RequestContext } from "@civitasone/types";

type ScreenJobStatus = "queued" | "running" | "completed" | "failed";
/**
 * DB status -> screen status. The DB stores 'processing' (jobs_status_check);
 * the screen contract calls the same state 'running'. Without the mapping an
 * in-progress job read back as 'queued'.
 */
function screenStatus(status: string): ScreenJobStatus {
  if (status === "processing" || status === "running") return "running";
  return (["queued", "completed", "failed"].includes(status) ? status : "queued") as ScreenJobStatus;
}
import type { JobView } from "./schema.js";

/**
 * Per-user scoping: a non-admin may only touch jobs they requested. Admin roles
 * keep tenant-wide access; legacy rows with a null requested_by are admin-only.
 * Returns 404 (not 403) so a job id belonging to someone else is not confirmed.
 */
function assertJobAccess<T extends JobView>(ctx: RequestContext, job: T | null): T {
  if (!job) throw new HttpError(404, "NOT_FOUND", "report job not found");
  if (!isReportAdmin(ctx) && job.requestedBy !== ctx.actorId) {
    throw new HttpError(404, "NOT_FOUND", "report job not found");
  }
  return job;
}

/**
 * GAP-REPORTS-LIST-04: job payloads must not carry the 24h presigned S3 bearer
 * URL. They expose the authorising download endpoint instead, so every fetch
 * is owner-checked and audited. Returns a copy (the cached row is shared).
 */
function downloadPath(id: string): string {
  return "/v1/reports/jobs/" + id + "/download";
}
function hideBearerUrl<T extends { id: string; downloadUrl: string | null }>(job: T): T {
  return { ...job, downloadUrl: job.downloadUrl ? downloadPath(job.id) : null };
}

export async function jobRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/reports/jobs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createJobBody.parse(req.body);
    // Owner decision #17: unmasked PII only for report_admin (and only with a reason,
    // enforced by the validator). Everyone else exports masked.
    if (body.unmaskPii) requireRole(ctx, REPORT_PII_UNMASK_ROLES);
    sendAccepted(reply, acceptedResponseSchema, await commands.createJob(ctx, body));
  });

  app.get("/v1/reports", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuerySchema.parse(req.query);
    const [result, total] = await Promise.all([
      queries.listJobs(ctx.tenantId, q.limit, q.offset, ownerScope(ctx)),
      queries.countJobs(ctx.tenantId, ownerScope(ctx)),
    ]);
    return reply.send({
      data: result.data.map(hideBearerUrl),
      // GAP2-REPORTS-PAGINATION-01: meta.total is the TRUE tenant-scoped row
      // count (count(*)), not result.data.length (the capped page size), so a
      // tenant with more than `limit` jobs gets a correct total and the UI can
      // tell there are more pages.
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });

  app.get("/v1/reports/jobs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuerySchema.parse(req.query);
    const jobs = await queries.listJobs(ctx.tenantId, q.limit, q.offset, ownerScope(ctx));
    sendValidated(reply, jobsListSchema, { ...jobs, data: jobs.data.map(hideBearerUrl) });
  });

  app.get("/v1/reports/report-jobs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuerySchema.parse(req.query);
    const result = await queries.listJobs(ctx.tenantId, q.limit, q.offset, ownerScope(ctx));
    sendValidated(reply, ReportJobSummaryListSchema, result.data.map((job) => ({
      id: job.id,
      reportName: job.name,
      module: job.reportType ?? "general",
      requestedBy: job.requestedBy ?? "unknown",
      // GAP2-REPORTS-JOBS-01: Requested is the job's real creation time
      // (reports.jobs.created_at), never the current request time. A still-
      // queued/running job must not appear "requested just now" on every load.
      requestedAt: new Date(job.createdAt as unknown as string).toISOString(),
      completedAt: job.completedAt ? new Date(job.completedAt as unknown as string).toISOString() : undefined,
      format: (["pdf", "xlsx", "csv", "html"].includes(job.format) ? job.format : "pdf") as "pdf" | "xlsx" | "csv" | "html",
      status: screenStatus(job.status),
      downloadUrl: job.downloadUrl ? downloadPath(job.id) : undefined,
      rowCount: job.rowCount ?? undefined,
    })));
  });

  app.get("/v1/reports/report-jobs/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const job = assertJobAccess(ctx, await queries.getJobDetail(ctx.tenantId, id));
    sendValidated(reply, ReportJobDetailSchema, {
      id: job.id,
      reportName: job.name,
      module: job.reportType ?? "general",
      requestedBy: job.requestedBy ?? "unknown",
      // GAP2-REPORTS-JOBS-01: Requested is the job's real creation time
      // (reports.jobs.created_at), never the current request time. A still-
      // queued/running job must not appear "requested just now" on every load.
      requestedAt: new Date(job.createdAt as unknown as string).toISOString(),
      completedAt: job.completedAt ? new Date(job.completedAt as unknown as string).toISOString() : undefined,
      format: (["pdf", "xlsx", "csv", "html"].includes(job.format) ? job.format : "pdf") as "pdf" | "xlsx" | "csv" | "html",
      status: screenStatus(job.status),
      downloadUrl: job.downloadUrl ? downloadPath(job.id) : undefined,
      rowCount: job.rowCount ?? undefined,
      parameters: job.parameters,
      columns: job.resultColumns,
      rows: job.resultRows,
      totalCount: job.rowCount ?? job.resultRows.length,
    });
  });


  app.get("/v1/reports/jobs/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const job = assertJobAccess(ctx, await queries.getJob(ctx.tenantId, id));
    return reply.send({ data: hideBearerUrl(job) });
  });

  app.post("/v1/reports/jobs/:id/share", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const { recipients, message } = shareJobBody.parse(req.body);
    const job = assertJobAccess(ctx, await queries.getJob(ctx.tenantId, id));
    if (job.status !== "completed" || !job.downloadUrl) {
      throw new HttpError(409, "NOT_READY", "report not yet completed");
    }
    // Owner decision #17: recipients get a link that expires in 15 minutes.
    const downloadUrl = await presignedGetUrl({ key: jobStorageKey(job.tenantId, job.id, job.format), expiresIn: DOWNLOAD_LINK_TTL_SECONDS });
    const result = await commands.shareJob(ctx, id, { recipients, ...(message !== undefined ? { message } : {}), downloadUrl });
    return reply.code(202).send({ data: result });
  });

  /** Download redirect — returns the presigned download URL for a completed job.
   *  Accepts optional `watermarkText` query param for ad-hoc watermarking. */
  app.get("/v1/reports/jobs/:id/download", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const { watermarkText } = downloadQuerySchema.parse(req.query);
    const job = assertJobAccess(ctx, await queries.getJob(ctx.tenantId, id));
    if (job.status !== "completed" || !job.downloadUrl) {
      throw new HttpError(409, "NOT_READY", "report is not yet completed or has no download URL");
    }
    // watermarkText is available for use in downstream re-render if needed;
    // for pre-rendered jobs, the watermark was applied at render time.
    // Ad-hoc watermark on already-rendered files is a future enhancement.
    // Owner decision #17: mint a fresh link that expires in 15 minutes from the
    // deterministic key. A stored (legacy 24h) URL is never handed out.
    const signed = await presignedGetUrl({ key: jobStorageKey(job.tenantId, job.id, job.format), expiresIn: DOWNLOAD_LINK_TTL_SECONDS });
    const url = watermarkText
      ? `${signed}${signed.includes("?") ? "&" : "?"}wm=${encodeURIComponent(watermarkText)}`
      : signed;
    // GAP-REPORTS-LIST-04: audit every download fetch; fail closed so a file is
    // never handed out without a trail. Denied (404) and not-ready (409) fetches
    // threw above, so only a real hand-out is recorded. No URL/watermark in payload.
    await queue.publish("audit.event.record", {
      messageId: randomUUID(),
      type: "audit.event.record",
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: {
        service: "report", action: "download", resourceType: "report_job", resourceId: job.id,
        outcome: "success", format: job.format, ownerId: job.requestedBy, watermarked: Boolean(watermarkText),
      },
    });
    return reply.redirect(302, url);
  });

  app.get("/v1/reports/kpis", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, KPISummaryListSchema, await kpiQueries.listKpis(ctx.tenantId, q.limit));
  });

  app.get("/v1/reports/mis", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
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
