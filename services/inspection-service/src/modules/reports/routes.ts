/**
 * reports module routes (SVC-062).
 *
 * GET  /v1/inspection/reports                    — list reports
 * POST /v1/inspection/reports                    — create report
 * GET  /v1/inspection/reports/:id                — get report detail
 * POST /v1/inspection/reports/:id/observations   — add observation
 * POST /v1/inspection/reports/:id/submit         — submit for review
 * POST /v1/inspection/reports/:id/approve        — approve report
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const INSPECTOR_ROLES = ["inspector", "reviewing_officer", "inspection_admin", "tenant_admin", "super_admin"];
const REVIEWER_ROLES  = ["reviewing_officer", "inspection_admin", "tenant_admin", "super_admin"];
const READ_ROLES      = [...INSPECTOR_ROLES, "supervising_officer"];

const idParam = z.object({ id: z.string().uuid("id must be a valid UUID") });

const createBody = z.object({
  inspectionId:    z.string().uuid(),
  entityId:        z.string().uuid(),
  reportType:      z.enum(["standard", "surprise", "follow_up", "joint"]).optional(),
  summary:         z.string().max(4000).optional(),
  recommendations: z.string().max(4000).optional(),
  overallGrade:    z.enum(["A", "B", "C", "D", "F"]).optional(),
});

const observationBody = z.object({
  category:    z.string().min(1).max(64),
  severity:    z.enum(["critical", "major", "minor", "observation"]),
  description: z.string().min(1).max(4000),
  location:    z.string().max(256).optional(),
  evidenceIds: z.array(z.string().uuid()).optional(),
});

const listQuery = z.object({
  inspectionId: z.string().uuid().optional(),
  status:       z.enum(["draft", "submitted", "approved", "rejected"]).optional(),
  page:         z.coerce.number().int().positive().default(1),
  pageSize:     z.coerce.number().int().positive().max(100).default(20),
});

export async function registerReportsRoutes(app: FastifyInstance): Promise<void> {
  // List reports
  app.get("/v1/inspection/reports", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuery.parse(req.query);
    const data = await repo.listReports(ctx.tenantId, {
      inspectionId: q.inspectionId,
      status: q.status,
      page: q.page,
      pageSize: q.pageSize,
    });
    return reply.send({ data, page: q.page, pageSize: q.pageSize });
  });

  // Create report
  app.post("/v1/inspection/reports", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INSPECTOR_ROLES);
    const body = createBody.parse(req.body);
    const result = await commands.createReport(ctx, body);
    return reply.code(202).send({ data: result });
  });

  // Get report by id
  app.get("/v1/inspection/reports/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const report = await repo.findReportById(ctx.tenantId, id);
    if (!report) throw new HttpError(404, "NOT_FOUND", "inspection report not found");
    const observationsList = await repo.listObservations(ctx.tenantId, id);
    return reply.send({ data: { ...report, observations: observationsList } });
  });

  // Add observation to report
  app.post("/v1/inspection/reports/:id/observations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INSPECTOR_ROLES);
    const { id } = idParam.parse(req.params);
    const report = await repo.findReportById(ctx.tenantId, id);
    if (!report) throw new HttpError(404, "NOT_FOUND", "inspection report not found");
    if (!["draft", "submitted"].includes(report.status)) {
      throw new HttpError(409, "CONFLICT", "cannot add observations to a finalized report");
    }
    const body = observationBody.parse(req.body);
    const result = await commands.addObservation(ctx, id, body);
    return reply.code(202).send({ data: result });
  });

  // Submit report for review
  app.post("/v1/inspection/reports/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INSPECTOR_ROLES);
    const { id } = idParam.parse(req.params);
    const report = await repo.findReportById(ctx.tenantId, id);
    if (!report) throw new HttpError(404, "NOT_FOUND", "inspection report not found");
    if (report.status !== "draft") throw new HttpError(409, "CONFLICT", "report is not in draft status");
    const result = await commands.submitReport(ctx, id);
    return reply.code(202).send({ data: result });
  });

  // Approve report
  app.post("/v1/inspection/reports/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVIEWER_ROLES);
    const { id } = idParam.parse(req.params);
    const report = await repo.findReportById(ctx.tenantId, id);
    if (!report) throw new HttpError(404, "NOT_FOUND", "inspection report not found");
    if (report.status !== "submitted") throw new HttpError(409, "CONFLICT", "report is not in submitted status");
    const result = await commands.approveReport(ctx, id);
    return reply.code(202).send({ data: result });
  });
}
