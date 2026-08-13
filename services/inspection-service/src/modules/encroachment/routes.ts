/**
 * Encroachment module — HTTP routes.
 *
 * Endpoints:
 *   POST /v1/inspection/encroachment/complaints — file complaint
 *   GET  /v1/inspection/encroachment/complaints — list complaints
 *   GET  /v1/inspection/encroachment/complaints/:id — get complaint
 *   POST /v1/inspection/encroachment/complaints/:id/verify — record land verification
 *   POST /v1/inspection/encroachment/notices — issue notice
 *   GET  /v1/inspection/encroachment/notices — list notices
 *   POST /v1/inspection/encroachment/notices/:id/serve — mark notice served
 *   POST /v1/inspection/encroachment/notices/:id/respond — record response
 *   POST /v1/inspection/encroachment/hearings — schedule hearing
 *   GET  /v1/inspection/encroachment/hearings — list hearings
 *   POST /v1/inspection/encroachment/hearings/:id/complete — record proceedings+decision
 *   POST /v1/inspection/encroachment/removals — order removal
 *   POST /v1/inspection/encroachment/removals/:id/assign-team — assign team
 *   POST /v1/inspection/encroachment/removals/:id/complete — complete removal
 *
 * _Requirements: BRD 5.19 ENCR-001..004_
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  publishCreateComplaint,
  publishVerifyComplaint,
  publishIssueNotice,
  publishServeNotice,
  publishRecordNoticeResponse,
  publishScheduleHearing,
  publishCompleteHearing,
  publishOrderRemoval,
  publishAssignRemovalTeam,
  publishCompleteRemoval,
} from "./commands.js";
import {
  findComplaints,
  findComplaintById,
  findNotices,
  findNoticeById,
  findHearings,
  findHearingById,
  findRemovalById,
} from "./repo.js";

// ─── RBAC ────────────────────────────────────────────────────────────────────

const ADMIN_ROLES = ["inspection_admin", "tenant_admin", "super_admin"];
const WRITE_ROLES = ["inspector", "reviewing_officer", "inspection_admin",
  "tenant_admin", "super_admin"];
const READ_ROLES = ["inspector", "reviewing_officer", "inspection_admin",
  "tenant_admin", "super_admin"];

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const idParam = z.object({ id: z.string().uuid() });

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(15),
  status: z.string().optional(),
  complaintId: z.string().uuid().optional(),
});

const createComplaintSchema = z.object({
  reportedBy: z.string().uuid(),
  location: z.record(z.unknown()),
  encroachmentType: z.enum([
    "unauthorized_construction", "road_encroachment", "footpath_occupation",
    "public_land_grab", "hawker_zone_violation", "drainage_obstruction",
  ]),
  description: z.string().min(1),
  photos: z.array(z.unknown()).optional(),
  landParcelRef: z.string().optional(),
});

const verifyComplaintSchema = z.object({
  landVerificationReport: z.record(z.unknown()),
});

const issueNoticeSchema = z.object({
  complaintId: z.string().uuid(),
  noticeType: z.enum(["show_cause", "eviction", "demolition"]),
  issuedTo: z.string().min(1),
  responseDeadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const respondNoticeSchema = z.object({
  responseText: z.string().min(1),
});

const scheduleHearingSchema = z.object({
  complaintId: z.string().uuid(),
  noticeId: z.string().uuid(),
  hearingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hearingTime: z.string().max(8),
  venue: z.string().min(1),
  officerId: z.string().uuid(),
});

const completeHearingSchema = z.object({
  attendees: z.array(z.unknown()).optional(),
  proceedings: z.string().min(1),
  decision: z.enum(["removal_ordered", "fine_imposed", "regularized", "dismissed", "adjourned"]),
  fineAmountMinor: z.string().optional(),
  nextHearingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const orderRemovalSchema = z.object({
  complaintId: z.string().uuid(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const assignTeamSchema = z.object({
  teamMembers: z.array(z.unknown()).min(1),
  equipmentUsed: z.string().optional(),
});

const completeRemovalSchema = z.object({
  completionReport: z.record(z.unknown()),
  photos: z.array(z.unknown()).optional(),
});

// ─── Route registration ─────────────────────────────────────────────────────

export async function registerEncroachmentRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /v1/inspection/encroachment/complaints ──
  app.post("/v1/inspection/encroachment/complaints", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createComplaintSchema.parse(req.body);
    const result = await publishCreateComplaint(body, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── GET /v1/inspection/encroachment/complaints ──
  app.get("/v1/inspection/encroachment/complaints", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = listQuerySchema.parse(req.query);
    const result = await findComplaints(ctx.tenantId, {
      page: query.page,
      pageSize: query.pageSize,
    }, { status: query.status });
    return reply.send(result);
  });

  // ── GET /v1/inspection/encroachment/complaints/:id ──
  app.get("/v1/inspection/encroachment/complaints/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const complaint = await findComplaintById(ctx.tenantId, id);
    if (!complaint) throw new HttpError(404, "NOT_FOUND", "encroachment complaint not found");
    return reply.send({ data: complaint });
  });

  // ── POST /v1/inspection/encroachment/complaints/:id/verify ──
  app.post("/v1/inspection/encroachment/complaints/:id/verify", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const complaint = await findComplaintById(ctx.tenantId, id);
    if (!complaint) throw new HttpError(404, "NOT_FOUND", "encroachment complaint not found");
    const body = verifyComplaintSchema.parse(req.body);
    const result = await publishVerifyComplaint({ complaintId: id, ...body }, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/inspection/encroachment/notices ──
  app.post("/v1/inspection/encroachment/notices", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = issueNoticeSchema.parse(req.body);
    const result = await publishIssueNotice(body, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── GET /v1/inspection/encroachment/notices ──
  app.get("/v1/inspection/encroachment/notices", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = listQuerySchema.parse(req.query);
    const result = await findNotices(ctx.tenantId, {
      page: query.page,
      pageSize: query.pageSize,
    }, { complaintId: query.complaintId, status: query.status });
    return reply.send(result);
  });

  // ── POST /v1/inspection/encroachment/notices/:id/serve ──
  app.post("/v1/inspection/encroachment/notices/:id/serve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const notice = await findNoticeById(ctx.tenantId, id);
    if (!notice) throw new HttpError(404, "NOT_FOUND", "encroachment notice not found");
    const result = await publishServeNotice({ noticeId: id }, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/inspection/encroachment/notices/:id/respond ──
  app.post("/v1/inspection/encroachment/notices/:id/respond", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const notice = await findNoticeById(ctx.tenantId, id);
    if (!notice) throw new HttpError(404, "NOT_FOUND", "encroachment notice not found");
    const body = respondNoticeSchema.parse(req.body);
    const result = await publishRecordNoticeResponse({ noticeId: id, ...body }, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/inspection/encroachment/hearings ──
  app.post("/v1/inspection/encroachment/hearings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = scheduleHearingSchema.parse(req.body);
    const result = await publishScheduleHearing(body, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── GET /v1/inspection/encroachment/hearings ──
  app.get("/v1/inspection/encroachment/hearings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = listQuerySchema.parse(req.query);
    const result = await findHearings(ctx.tenantId, {
      page: query.page,
      pageSize: query.pageSize,
    }, { complaintId: query.complaintId, status: query.status });
    return reply.send(result);
  });

  // ── POST /v1/inspection/encroachment/hearings/:id/complete ──
  app.post("/v1/inspection/encroachment/hearings/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const hearing = await findHearingById(ctx.tenantId, id);
    if (!hearing) throw new HttpError(404, "NOT_FOUND", "encroachment hearing not found");
    const body = completeHearingSchema.parse(req.body);
    const result = await publishCompleteHearing({ hearingId: id, ...body }, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/inspection/encroachment/removals ──
  app.post("/v1/inspection/encroachment/removals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = orderRemovalSchema.parse(req.body);
    const result = await publishOrderRemoval(body, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/inspection/encroachment/removals/:id/assign-team ──
  app.post("/v1/inspection/encroachment/removals/:id/assign-team", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const removal = await findRemovalById(ctx.tenantId, id);
    if (!removal) throw new HttpError(404, "NOT_FOUND", "encroachment removal not found");
    const body = assignTeamSchema.parse(req.body);
    const result = await publishAssignRemovalTeam({ removalId: id, ...body }, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/inspection/encroachment/removals/:id/complete ──
  app.post("/v1/inspection/encroachment/removals/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const removal = await findRemovalById(ctx.tenantId, id);
    if (!removal) throw new HttpError(404, "NOT_FOUND", "encroachment removal not found");
    const body = completeRemovalSchema.parse(req.body);
    const result = await publishCompleteRemoval({ removalId: id, ...body }, ctx);
    return reply.code(202).send({ data: result });
  });
}
