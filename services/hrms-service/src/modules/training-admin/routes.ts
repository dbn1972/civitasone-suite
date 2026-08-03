import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import {
  canApprove, decideApproval, nextWaitlistPosition, pickPromotion, summariseAttendance,
} from "./domain.js";
import { createSessionBody, approveNominationBody, markAttendanceBody } from "./validators.js";
import * as repo from "./repo.js";

const HR_ROLES  = ["hr_admin", "hr_officer", "super_admin"];
const ALL_ROLES = [...HR_ROLES, "manager", "employee"];
const idParam = z.object({ id: z.string().uuid() });

export async function trainingAdminRoutes(app: FastifyInstance): Promise<void> {
  // ── Sessions / batches ──────────────────────────────────────────
  app.post("/v1/hrms/trainings/:id/sessions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = createSessionBody.parse(req.body);
    const training = await repo.getTraining(ctx.tenantId, id);
    if (!training) throw new HttpError(404, "NOT_FOUND", "training not found");
    const sid = randomUUID();
    const row = await publishF3Write(ctx, "training_admin_routes__0", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: row.id, capacity: row.capacity, status: row.status });
  });

  app.get("/v1/hrms/trainings/:id/sessions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(await repo.listSessions(ctx.tenantId, id));
  });

  // ── Nomination approval workflow (maker-checker + waitlist) ──────
  app.post("/v1/hrms/nominations/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = approveNominationBody.parse(req.body);
    const nom = await repo.getNomination(ctx.tenantId, id);
    if (!nom) throw new HttpError(404, "NOT_FOUND", "nomination not found");
    if (nom.status !== "nominated") throw new HttpError(409, "INVALID_STATE", "only a nominated entry can be approved");
    // Maker-checker: the approver must differ from the nominator.
    if (!canApprove(nom.nominatedBy, ctx.actorId)) {
      throw new HttpError(409, "MAKER_CHECKER", "approval requires a checker different from the nominator");
    }
    const session = await repo.getSession(ctx.tenantId, body.sessionId);
    if (!session) throw new HttpError(404, "NOT_FOUND", "session not found");

    const approvedCount = await repo.countApprovedForSession(ctx.tenantId, body.sessionId);
    const outcome = decideApproval(session.capacity, approvedCount);
    let waitlistPosition: number | null = null;
    if (outcome === "waitlisted") {
      const waited = await repo.countWaitlistedForSession(ctx.tenantId, body.sessionId);
      waitlistPosition = nextWaitlistPosition(waited);
    }
    const row = await publishF3Write(ctx, "training_admin_routes__1", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    if (!row) throw new HttpError(409, "INVALID_STATE", "nomination could not be decided from its current state");
    return reply.send({ id, status: row.status, sessionId: body.sessionId, waitlistPosition: row.waitlistPosition });
  });

  app.post("/v1/hrms/nominations/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const nom = await repo.getNomination(ctx.tenantId, id);
    if (!nom) throw new HttpError(404, "NOT_FOUND", "nomination not found");
    // Maker-checker also applies to rejection of a fresh nomination.
    if (nom.status === "nominated" && !canApprove(nom.nominatedBy, ctx.actorId)) {
      throw new HttpError(409, "MAKER_CHECKER", "rejection requires a checker different from the nominator");
    }
    const freedApproved = nom.status === "approved";
    const sessionId = nom.sessionId;
    const result = await publishF3Write(ctx, "training_admin_routes__2", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    if (!result) throw new HttpError(409, "INVALID_STATE", "nomination cannot be rejected from its current state");
    return reply.send({ id, status: "rejected", promoted: result.promotedId });
  });

  // ── Attendance capture per session ──────────────────────────────
  app.post("/v1/hrms/sessions/:id/attendance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = markAttendanceBody.parse(req.body);
    const session = await repo.getSession(ctx.tenantId, id);
    if (!session) throw new HttpError(404, "NOT_FOUND", "session not found");
    const row = await publishF3Write(ctx, "training_admin_routes__3", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ sessionId: id, employeeId: row.employeeId, status: row.status });
  });

  app.get("/v1/hrms/sessions/:id/attendance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = idParam.parse(req.params);
    const rows = await repo.listAttendance(ctx.tenantId, id);
    return reply.send({ records: rows, summary: summariseAttendance(rows) });
  });

  app.setErrorHandler(errorHandler);
}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
