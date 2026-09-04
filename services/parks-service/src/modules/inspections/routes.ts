import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { validateInspectionTransition, type InspectionStatus } from "./domain.js";
import * as complaintsRepo from "../complaints/repo.js";
import * as treeRequestsRepo from "../tree_requests/repo.js";

const ROLES = ["parks_user", "parks_admin", "super_admin"];
const ADMIN_ROLES = ["parks_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.string().optional(),
});

// BUG FIX (orphan inspection rows): complaintId/treeRequestId were both
// `.uuid().optional()` with no refinement requiring at least one of them —
// `POST /v1/parks/inspections` with body `{}` previously returned 202 and
// the consumer inserted a parks_inspections row with BOTH columns NULL,
// referencing nothing. `.refine` below closes that. Existence of whichever
// one IS supplied is checked in the handler below (a 404 there beats a
// 422 here for readability, and repo.findById needs live tenant context
// this schema doesn't have).
const createBody = z.object({
  complaintId: z.string().uuid().optional(),
  treeRequestId: z.string().uuid().optional(),
  scheduledDate: z.string().optional(),
}).refine((b) => Boolean(b.complaintId) || Boolean(b.treeRequestId), {
  message: "at least one of complaintId or treeRequestId is required",
  path: ["complaintId"],
});

const completeBody = z.object({
  findings: z.record(z.unknown()),
  photos: z.array(z.string().max(512)).optional(),
  workOrderRequired: z.boolean(),
  version: z.number().int().positive(),
});

export async function inspectionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/parks/inspections", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createBody.parse(req.body);
    // BUG FIX (orphan inspection rows, continued): neither this route nor
    // the SCHEDULE_INSPECTION consumer previously checked that a supplied
    // complaintId/treeRequestId actually referenced an existing row for
    // this tenant — an inspection could be scheduled against a
    // nonexistent (or another tenant's, pre-RLS-scoped) complaint/tree
    // request and the write would silently succeed. Checked here,
    // tenant-scoped, before the command is even published.
    if (body.complaintId) {
      const complaint = await complaintsRepo.findById(body.complaintId, ctx.tenantId);
      if (!complaint) throw new HttpError(404, "NOT_FOUND", "referenced complaint not found");
    }
    if (body.treeRequestId) {
      const treeRequest = await treeRequestsRepo.findById(body.treeRequestId, ctx.tenantId);
      if (!treeRequest) throw new HttpError(404, "NOT_FOUND", "referenced tree request not found");
    }
    return reply.code(202).send(await commands.createInspection(ctx, {
      complaintId: body.complaintId ?? null,
      treeRequestId: body.treeRequestId ?? null,
      scheduledDate: body.scheduledDate ?? null,
    }));
  });

  app.get("/v1/parks/inspections", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, q.status);
    return reply.send({ data: rows.map(repo.toView), meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total } });
  });

  app.get("/v1/parks/inspections/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const inspection = await repo.findById(id, ctx.tenantId);
    if (!inspection) throw new HttpError(404, "NOT_FOUND", "inspection not found");
    return reply.send({ data: repo.toView(inspection) });
  });

  app.post("/v1/parks/inspections/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = completeBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "inspection not found");
    // Was previously only guarded by an ad-hoc "not already completed" check,
    // which never called this module's own validateInspectionTransition —
    // meaning a "cancelled" inspection (once cancellation exists) could be
    // completed too. Uses the same TRANSITION_INVALID pattern as the
    // complaints/tree_requests modules for consistency.
    const err = validateInspectionTransition(existing.status as InspectionStatus, "completed");
    if (err) throw new HttpError(422, "TRANSITION_INVALID", err);
    if (body.version !== existing.version) throw new HttpError(409, "VERSION_CONFLICT", "retry with current version");
    return reply.code(202).send(await commands.completeInspection(ctx, id, body.findings, body.photos ?? null, body.workOrderRequired, body.version));
  });
}
