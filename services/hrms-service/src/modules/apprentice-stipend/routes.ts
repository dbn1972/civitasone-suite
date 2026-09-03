import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Apprentice / NAPS module (DIC Phase 3). Apprentices draw a monthly STIPEND
 * (Apprentices Act) — not salary, not an invoice. The stipend is pro-rated by
 * attendance; the government reimburses the employer a share (NAPS, default 25%
 * capped). No PF/ESI/TDS.
 *
 *   POST /v1/hrms/apprenticeships                enrol an apprentice
 *   GET  /v1/hrms/apprenticeships                list
 *   GET  /v1/hrms/apprenticeships/:id            read
 *   PATCH /v1/hrms/apprenticeships/:id           update (complete / terminate / rate)
 *   POST /v1/hrms/apprenticeships/:id/stipends   submit a monthly stipend run
 *   GET  /v1/hrms/apprenticeships/:id/stipends   list runs
 *   GET  /v1/hrms/apprentice-stipends?status=..   queue
 *   GET  /v1/hrms/apprentice-stipends/:stipendId  read
 *   POST /v1/hrms/apprentice-stipends/:stipendId/verify | /approve | /reject | /mark-paid
 *
 * approve computes the pro-rated stipend + NAPS reimbursement and emits a
 * Finance-AP outbox event (net employer cost). Two-person control. Money in paise.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { and, eq } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import { hrmsEmployees } from "../employee/schema.js";
import { loadTypeResolver } from "../employee/engagement-policy.js";
import { computeStipend } from "./domain.js";
import * as repo from "./repo.js";
import type { ApprenticeshipRow, StipendRow } from "./schema.js";

const FINANCE_ROLES = ["hr_admin", "super_admin", "finance_officer", "payroll_admin"];
const SUBMIT_ROLES = [...FINANCE_ROLES, "hr_officer", "manager"];

const idParam = z.object({ id: z.string().uuid() });
const stipendParam = z.object({ stipendId: z.string().uuid() });

function jsonSafe(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = jsonSafe(val);
    return out;
  }
  return v;
}

export async function apprenticeStipendRoutes(app: FastifyInstance): Promise<void> {
  // ══════════════════ apprenticeships ══════════════════
  app.post("/v1/hrms/apprenticeships", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = z.object({
      apprenticeId: z.string().uuid(),
      napsId: z.string().max(24).optional(),
      trade: z.string().max(120).optional(),
      qualification: z.enum(["school", "iti", "diploma", "graduate", "other"]).default("other"),
      monthlyStipendMinor: z.coerce.number().int().positive(),
      napsReimbPctBps: z.coerce.number().int().min(0).max(10000).default(2500),
      napsReimbCapMinor: z.coerce.number().int().min(0).default(150000),
      trainingStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      trainingEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).parse(req.body);

    const emp = await mustEmployee(ctx.tenantId, body.apprenticeId);
    // Boundary guard: a payroll-eligible (salaried) employee is paid via payroll,
    // not a stipend. Fail-open on resolver error.
    const resolver = await loadTypeResolver(ctx.tenantId).catch((err: unknown) => {
      req.log.error({ err, event: "apprentice.resolver_failed", tenantId: ctx.tenantId }, "engagement resolver failed — allowing");
      return null;
    });
    if (resolver && resolver(emp.employeeType ?? "").eligibleForPayroll) {
      throw new HttpError(409, "NOT_AN_APPRENTICE",
        `employee '${body.apprenticeId}' is a payroll-eligible engagement type — salaried staff are paid via payroll, not an apprentice stipend`);
    }

    const id = randomUUID();
    await publishF3Write(ctx, "apprentice_stipend_routes__0", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id, apprenticeId: body.apprenticeId, status: "active" }) as any;
  });

  app.get("/v1/hrms/apprenticeships", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SUBMIT_ROLES);
    return reply.send(jsonSafe({ data: await repo.listApprenticeships(ctx.tenantId) }));
  });

  app.get("/v1/hrms/apprenticeships/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SUBMIT_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(jsonSafe(await mustApprenticeship(ctx.tenantId, id)));
  });

  app.patch("/v1/hrms/apprenticeships/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      monthlyStipendMinor: z.coerce.number().int().positive().optional(),
      trainingEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      status: z.enum(["active", "completed", "terminated"]).optional(),
    }).parse(req.body ?? {});
    const a = await mustApprenticeship(ctx.tenantId, id);
    const patch: Record<string, unknown> = { updatedBy: ctx.actorId };
    if (body.monthlyStipendMinor !== undefined) patch.monthlyStipendMinor = BigInt(body.monthlyStipendMinor);
    if (body.trainingEnd !== undefined) patch.trainingEnd = body.trainingEnd;
    if (body.status !== undefined) patch.status = body.status;
    await publishF3Write(ctx, "apprentice_stipend_routes__1", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: body.status ?? a.status }) as any;
  });

  // ══════════════════ stipend runs ══════════════════
  app.post("/v1/hrms/apprenticeships/:id/stipends", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SUBMIT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/),
      workingDays: z.coerce.number().int().positive().max(31),
      daysPresent: z.coerce.number().int().min(0).max(31),
      remarks: z.string().max(2000).optional(),
    }).parse(req.body);
    if (body.daysPresent > body.workingDays) {
      throw new HttpError(400, "INVALID_ATTENDANCE", "daysPresent cannot exceed workingDays");
    }
    const a = await mustApprenticeship(ctx.tenantId, id);
    if (a.status !== "active") throw new HttpError(409, "APPRENTICESHIP_INACTIVE", `apprenticeship is '${a.status}', not active`);

    // Synchronous pre-check, mirroring the table's own UNIQUE(tenant_id,
    // apprenticeship_id, month) constraint (hrms_apprentice_stipends_month_uq):
    // publishF3Write is fire-and-forget (queue.publish() always defers
    // delivery — MemoryQueue via setTimeout(0), Redis Streams similarly), so
    // the try/catch this replaced — wrapped around publishF3Write itself,
    // hoping to catch a `23505` from the consumer's later insertStipend call
    // — was dead code: the actual insert (and any real constraint violation)
    // only happens well after this handler has already sent its response.
    // Every duplicate resubmit silently returned 201. Same class of fix as
    // the synchronous pre-checks throughout manpower-planning/routes.ts.
    const existing = await repo.findStipendByMonth(ctx.tenantId, id, body.month);
    if (existing) {
      throw new HttpError(409, "DUPLICATE_STIPEND", `a stipend run for '${body.month}' already exists for this apprentice`);
    }

    const stipendId = randomUUID();
    await publishF3Write(ctx, "apprentice_stipend_routes__2", stipendId, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send(jsonSafe({ id: stipendId, apprenticeshipId: id, month: body.month, status: "submitted" }));
  });

  app.get("/v1/hrms/apprenticeships/:id/stipends", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SUBMIT_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(jsonSafe({ data: await repo.listStipendsByApprenticeship(ctx.tenantId, id) }));
  });

  app.get("/v1/hrms/apprentice-stipends", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const q = z.object({ status: z.enum(["submitted", "verified", "approved", "rejected", "paid"]).default("submitted") }).parse(req.query);
    return reply.send(jsonSafe({ data: await repo.listStipendsByStatus(ctx.tenantId, q.status) }));
  });

  app.get("/v1/hrms/apprentice-stipends/:stipendId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SUBMIT_ROLES);
    const { stipendId } = stipendParam.parse(req.params);
    return reply.send(jsonSafe(await mustStipend(ctx.tenantId, stipendId)));
  });

  app.post("/v1/hrms/apprentice-stipends/:stipendId/verify", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { stipendId } = stipendParam.parse(req.params);
    const s = await mustStipend(ctx.tenantId, stipendId);
    if (s.status !== "submitted") throw new HttpError(409, "WRONG_STATE", `stipend is '${s.status}', not submitted`);
    await publishF3Write(ctx, "apprentice_stipend_routes__3", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({ id: stipendId, status: "verified" })) as any;
  });

  app.post("/v1/hrms/apprentice-stipends/:stipendId/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { stipendId } = stipendParam.parse(req.params);
    const body = z.object({ approverRemarks: z.string().max(2000).optional() }).parse(req.body ?? {});
    const s = await mustStipend(ctx.tenantId, stipendId);
    if (s.status !== "verified") throw new HttpError(409, "WRONG_STATE", `stipend is '${s.status}', not verified`);
    if (s.verifiedBy && s.verifiedBy === ctx.actorId) {
      throw new HttpError(409, "SOD_VIOLATION", "approver must differ from the verifier (two-person control)");
    }
    const a = await mustApprenticeship(ctx.tenantId, s.apprenticeshipId);
    // Compute against the values SNAPSHOTTED on the run at submit (not the live
    // master), so the amount agreed for the period is what gets approved.
    const stipend = computeStipend({
      monthlyStipendMinor: s.monthlyStipendMinor,
      workingDays: s.workingDays, daysPresent: s.daysPresent,
      napsReimbPctBps: s.napsReimbPctBps, napsReimbCapMinor: s.napsReimbCapMinor,
    });
    await publishF3Write(ctx, "apprentice_stipend_routes__4", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({
      id: stipendId, status: "approved", month: s.month,
      grossStipendMinor: stipend.grossStipendMinor, napsReimbMinor: stipend.napsReimbMinor,
      employerCostMinor: stipend.employerCostMinor,
    })) as any;
  });

  app.post("/v1/hrms/apprentice-stipends/:stipendId/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { stipendId } = stipendParam.parse(req.params);
    const body = z.object({ approverRemarks: z.string().max(2000).optional() }).parse(req.body ?? {});
    const s = await mustStipend(ctx.tenantId, stipendId);
    if (s.status !== "submitted" && s.status !== "verified") {
      throw new HttpError(409, "WRONG_STATE", `stipend is '${s.status}', cannot reject`);
    }
    await publishF3Write(ctx, "apprentice_stipend_routes__5", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({ id: stipendId, status: "rejected" })) as any;
  });

  app.post("/v1/hrms/apprentice-stipends/:stipendId/mark-paid", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { stipendId } = stipendParam.parse(req.params);
    const body = z.object({ paymentRef: z.string().min(1).max(64) }).parse(req.body ?? {});
    const s = await mustStipend(ctx.tenantId, stipendId);
    if (s.status !== "approved") throw new HttpError(409, "WRONG_STATE", `stipend is '${s.status}', not approved`);
    await publishF3Write(ctx, "apprentice_stipend_routes__6", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({ id: stipendId, status: "paid", paymentRef: body.paymentRef })) as any;
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });

  async function mustEmployee(tenantId: string, id: string) {
    const rows = await scopedRead((tx) => tx.select().from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, tenantId))).limit(1));
    const emp = rows[0];
    if (!emp) throw new HttpError(404, "NOT_FOUND", "apprentice (employee) not found");
    return emp;
  }
  async function mustApprenticeship(tenantId: string, id: string): Promise<ApprenticeshipRow> {
    const a = await repo.findApprenticeship(tenantId, id);
    if (!a) throw new HttpError(404, "NOT_FOUND", "apprenticeship not found");
    return a;
  }
  async function mustStipend(tenantId: string, id: string): Promise<StipendRow> {
    const s = await repo.findStipend(tenantId, id);
    if (!s) throw new HttpError(404, "NOT_FOUND", "stipend run not found");
    return s;
  }
}
