import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { canTransition, canApprove } from "./domain.js";

const ROADCUT_ROLES = ["roadcut_user", "roadcut_admin", "super_admin"];
const ADMIN_ROLES = ["roadcut_admin", "super_admin"];

// Cutting dimensions are persisted as strings (see architecture note on
// roadcut_applications.cutting_length et al.) but MUST be genuine positive
// decimal numbers: the applications consumer feeds them straight into
// parseFloat() -> BigInt(Math.ceil(...)) fee/deposit math, and BigInt()
// throws a RangeError on NaN. A weaker `.min(1)` check let non-numeric
// strings ("abc") through the route, producing a 202 response for a command
// that then fails permanently in the async consumer (poison-pill message,
// confirmed live: applications with cuttingLength:"abc" are accepted but
// never created).
const positiveDecimalString = z
  .string()
  .regex(/^\d+(\.\d+)?$/, "must be a positive decimal number")
  .refine((v) => parseFloat(v) > 0, "must be greater than 0");

const createBody = z.object({
  applicantName: z.string().min(1).max(256),
  applicantOrg: z.string().max(256).optional(),
  purpose: z.enum(["water_pipe", "sewer_pipe", "gas_pipe", "telecom", "electricity", "other"]),
  location: z.object({
    latitude: z.number(),
    longitude: z.number(),
    address: z.string().min(1),
    ward: z.string().optional(),
    zone: z.string().optional(),
  }),
  roadType: z.enum(["arterial", "sub_arterial", "collector", "local"]),
  cuttingLength: positiveDecimalString,
  cuttingWidth: positiveDecimalString,
  cuttingDepth: positiveDecimalString,
  documents: z.array(z.object({
    docType: z.string(),
    fileId: z.string().uuid(),
    uploadedAt: z.string().datetime(),
  })).optional(),
});

const listQuery = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

const idParam = z.object({ id: z.string().uuid() });
const rejectBody = z.object({ reason: z.string().min(1) });

export async function applicationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/roadcut/applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROADCUT_ROLES);
    const body = createBody.parse(req.body);
    return reply.code(202).send(await commands.createApplication(ctx, body));
  });

  app.get("/v1/roadcut/applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROADCUT_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({
      data: rows,
      meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total },
    });
  });

  app.get("/v1/roadcut/applications/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROADCUT_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = `roadcut:${ctx.tenantId}:application:${id}`;
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    return reply.send({ data: row });
  });

  app.post("/v1/roadcut/applications/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROADCUT_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    if (!canTransition(existing.status, "submitted")) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot submit application in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.submitApplication(ctx, id));
  });

  app.post("/v1/roadcut/applications/:id/withdraw", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROADCUT_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    if (!canTransition(existing.status, "withdrawn")) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot withdraw application in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.withdrawApplication(ctx, id));
  });

  // Staff-only: claim an application for review. Required to make the
  // declared submitted -> under_review -> approved/rejected transition table
  // in domain.ts actually reachable (previously no route/command implemented
  // this transition at all, so an application could be submitted but never
  // legally move to under_review/approved/rejected via any endpoint).
  app.post("/v1/roadcut/applications/:id/start-review", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    if (!canTransition(existing.status, "under_review")) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot start review for application in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.startReview(ctx, id));
  });

  app.post("/v1/roadcut/applications/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    if (!canTransition(existing.status, "approved")) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot approve application in status '${existing.status}'`);
    }
    if (!canApprove(existing.status, existing.feeMinor, existing.depositMinor)) {
      throw new HttpError(422, "FEE_NOT_SET", "Application fee/deposit have not been calculated; cannot approve");
    }
    return reply.code(202).send(await commands.approveApplication(ctx, id));
  });

  app.post("/v1/roadcut/applications/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = rejectBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    if (!canTransition(existing.status, "rejected")) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot reject application in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.rejectApplication(ctx, id, body.reason));
  });
}
