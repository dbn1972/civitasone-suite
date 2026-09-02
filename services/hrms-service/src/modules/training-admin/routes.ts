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
    // Reuse `sid` as the id passed to publishF3Write: f3-consumer.ts __0
    // inserts the new session row using the message's `id` (i.e. whatever id
    // is passed here), so this route must pass the same id it reports back
    // to the client, not a second, unrelated randomUUID().
    await publishF3Write(ctx, "training_admin_routes__0", sid, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    // publishF3Write only ever resolves { id, status, correlationId }
    // (shared/f3-publish.ts) — it never carries `capacity`, so `row.capacity`
    // was always `undefined`, and `row.status` was always the placeholder's
    // "accepted", never the row's real "scheduled". `body.capacity` already
    // carries the validator's `.default(30)`, matching what the consumer
    // writes; "scheduled" is the only status insertSession ever sets.
    return reply.code(201).send({ id: sid, capacity: body.capacity, status: "scheduled" }) as any;
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
    // No further pre-check needed here: repo.decideNomination is guarded to
    // `status IN ('nominated')`, and the `nom.status !== "nominated"` check
    // above already enforces exactly that before publish — so the old
    // `if (!row) throw 409` was always dead (the publishF3Write placeholder
    // is always truthy), and `row.status` / `row.waitlistPosition` were
    // always `undefined`. `outcome`/`waitlistPosition` above are the same
    // decideApproval/nextWaitlistPosition computation the consumer
    // (f3-consumer.ts __1) performs over the same session/approvedCount, so
    // they're safe to report synchronously.
    //
    // KNOWN FOLLOW-UP (TOCTOU, not fixed here): `approvedCount` (and, when
    // waitlisted, `waited`) are snapshot reads at request time, and the
    // consumer independently re-reads the same counts later, at actual write
    // time. Two concurrent approve calls for the same session can both read
    // the same counts and both report the same `outcome`/`waitlistPosition`
    // here — e.g. both told "approved" when only one seat remains, or both
    // given the same waitlist position — while the consumer's later,
    // serialized re-read resolves them correctly once both writes land. This
    // doesn't corrupt DB state, only the synchronously-reported values can
    // drift from it. Deliberately not fixed in this pass — reserving the
    // seat/waitlist slot synchronously needs its own design thought,
    // matching how interview-recording-routes.ts's version-conflict race is
    // disclosed rather than rushed.
    await publishF3Write(ctx, "training_admin_routes__1", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: outcome, sessionId: body.sessionId, waitlistPosition });
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
    // Synchronous pre-check, matching repo.rejectNomination's own
    // `status IN ('nominated','waitlisted','approved')` WHERE clause — the
    // route previously had no equivalent check at all, so the dead
    // `if (!result) throw 409` below never actually caught an already-decided
    // nomination.
    //
    // This must match repo.rejectNomination's allow-list exactly, not just
    // exclude "rejected": the nominations table's CHECK constraint (migration
    // 0046_learning_competency.sql) also allows "attended", "completed" and
    // "cancelled", and "completed" is reachable via the separate, live
    // POST /v1/hrms/nominations/:id/complete route in training/routes.ts,
    // which shares this same table. An `!== "rejected"` check would wrongly
    // let a completed nomination through here: publishF3Write would fire,
    // this route would report 200 { status: "rejected" }, but
    // repo.rejectNomination's WHERE clause wouldn't match "completed" and
    // would silently no-op — the caller told success while the row stayed
    // "completed" forever.
    const REJECTABLE_STATUSES = ["nominated", "waitlisted", "approved"];
    if (!REJECTABLE_STATUSES.includes(nom.status)) {
      throw new HttpError(409, "INVALID_STATE", "nomination cannot be rejected from its current state");
    }
    // publishF3Write only ever resolves { id, status, correlationId } — it
    // never carries `promotedId`, so `result.promotedId` was always
    // `undefined`. Unlike the true write-time races elsewhere in this PR
    // (e.g. interview-recording's version-conflict check), WHICH nomination
    // gets promoted is a pure, deterministic function
    // (pickPromotion — already imported above) of the CURRENT waitlist for
    // this session, read the same way f3-consumer.ts __2 reads it. Compute it
    // here from the nomination's PRE-rejection state, mirroring that
    // consumer's own "read before repo.rejectNomination overwrites `status`"
    // ordering.
    const freedApproved = nom.status === "approved";
    let promoted: string | null = null;
    if (freedApproved && nom.sessionId) {
      const waitlisted = await repo.listWaitlisted(ctx.tenantId, nom.sessionId);
      promoted = pickPromotion(waitlisted);
    }
    await publishF3Write(ctx, "training_admin_routes__2", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: "rejected", promoted });
  });

  // ── Attendance capture per session ──────────────────────────────
  app.post("/v1/hrms/sessions/:id/attendance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = markAttendanceBody.parse(req.body);
    const session = await repo.getSession(ctx.tenantId, id);
    if (!session) throw new HttpError(404, "NOT_FOUND", "session not found");
    await publishF3Write(ctx, "training_admin_routes__3", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    // publishF3Write's placeholder never carries `employeeId`/the real
    // `status` — `row.employeeId` was always `undefined` and `row.status`
    // was always "accepted", never the marked status. `body.employeeId` and
    // `body.status` (defaulted to "present" by the validator) are exactly
    // what repo.upsertAttendance writes.
    return reply.code(201).send({ sessionId: id, employeeId: body.employeeId, status: body.status }) as any;
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
