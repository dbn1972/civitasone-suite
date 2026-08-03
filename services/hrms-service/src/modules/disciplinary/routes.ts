import type { RequestContext } from "@civitasone/types";
import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Disciplinary / Vigilance (CCS (CCA) Rules) module.
 *
 *   POST /v1/hrms/employees/:id/disciplinary-cases     open a case
 *   GET  /v1/hrms/employees/:id/disciplinary-cases     list cases for an employee
 *   GET  /v1/hrms/disciplinary-cases/:caseId           read a case
 *   GET  /v1/hrms/disciplinary-cases/:caseId/events    state-transition history
 *   POST /v1/hrms/disciplinary-cases/:caseId/charge-memo
 *   POST /v1/hrms/disciplinary-cases/:caseId/inquiry
 *   POST /v1/hrms/disciplinary-cases/:caseId/finding
 *   POST /v1/hrms/disciplinary-cases/:caseId/penalty
 *   POST /v1/hrms/disciplinary-cases/:caseId/appeal
 *   POST /v1/hrms/disciplinary-cases/:caseId/appeal-decision
 *   POST /v1/hrms/disciplinary-cases/:caseId/close
 *   POST /v1/hrms/disciplinary-cases/:caseId/drop
 *
 *   POST /v1/hrms/employees/:id/suspensions            record a suspension (pay flag)
 *   GET  /v1/hrms/employees/:id/suspensions            list suspensions
 *   POST /v1/hrms/suspensions/:suspId/revoke           revoke a suspension
 *
 * Each case transition is validated by the state machine and appended to an
 * append-only event log. A suspension with pay_suspended=true is surfaced by
 * the payroll-input projection.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import { and, eq } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead} from "../../shared/db.js";
import { hrmsEmployees } from "../employee/schema.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import {
  canTransition, penaltyClassOf, MINOR_PENALTIES, MAJOR_PENALTIES,
  type CaseStatus, type CaseAction,
} from "./state-machine.js";
import type { DisciplinaryCaseRow } from "./schema.js";

const HR_ROLES = ["hr_admin", "super_admin"];
const VIGILANCE_ROLES = [...HR_ROLES, "hr_officer"];
const idParam = z.object({ id: z.string().uuid() });
const caseParam = z.object({ caseId: z.string().uuid() });
const suspParam = z.object({ suspId: z.string().uuid() });

async function mustEmployee(tenantId: string, id: string) {
  const rows = await scopedRead((tx) => tx.select().from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, tenantId))).limit(1));
  const emp = rows[0];
  if (!emp) throw new HttpError(404, "NOT_FOUND", "employee not found");
  return emp;
}

export async function disciplinaryRoutes(app: FastifyInstance): Promise<void> {
  async function mustCase(tenantId: string, caseId: string): Promise<DisciplinaryCaseRow> {
    const c = await repo.findCase(tenantId, caseId);
    if (!c) throw new HttpError(404, "NOT_FOUND", "disciplinary case not found");
    return c;
  }

  /** Run a guarded transition: validate, patch the case, append the event. */
  async function transition(
    c: DisciplinaryCaseRow, action: CaseAction, actorId: string,
    patch: Partial<typeof c>, notes: string | null,
    ctx: RequestContext, req: FastifyRequest,
  ): Promise<CaseStatus> {
    const check = canTransition(
      c.status as CaseStatus, action, c.proceedingType as "minor" | "major");
    if (!check.ok || !check.to) throw new HttpError(409, "WRONG_STATE", check.reason ?? "invalid transition");
    const to: CaseStatus = check.to;
    await publishF3Write(ctx, "disciplinary_routes__0", randomUUID(), {
      body: (req.body as Record<string, unknown>) ?? {},
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      action, patch, notes, caseId: c.id, actorId, to,
    });
    return to;
  }

  // -------- open / list / read --------
  app.post("/v1/hrms/employees/:id/disciplinary-cases", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VIGILANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      caseNo: z.string().min(1).max(48),
      proceedingType: z.enum(["minor", "major"]).default("major"),
      allegation: z.string().min(1).max(8000),
    }).parse(req.body);
    await mustEmployee(ctx.tenantId, id);
    const caseId = randomUUID();
    await publishF3Write(ctx, "disciplinary_routes__1", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: caseId, employeeId: id, status: "opened", caseNo: body.caseNo }) as any;
  });

  app.get("/v1/hrms/employees/:id/disciplinary-cases", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VIGILANCE_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send({ data: await repo.listCasesByEmployee(ctx.tenantId, id) });
  });

  app.get("/v1/hrms/disciplinary-cases/:caseId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VIGILANCE_ROLES);
    const { caseId } = caseParam.parse(req.params);
    return reply.send(await mustCase(ctx.tenantId, caseId));
  });

  app.get("/v1/hrms/disciplinary-cases/:caseId/events", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VIGILANCE_ROLES);
    const { caseId } = caseParam.parse(req.params);
    await mustCase(ctx.tenantId, caseId);
    return reply.send({ data: await repo.listEvents(ctx.tenantId, caseId) });
  });

  // -------- transitions --------
  app.post("/v1/hrms/disciplinary-cases/:caseId/charge-memo", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VIGILANCE_ROLES);
    const { caseId } = caseParam.parse(req.params);
    const body = z.object({
      chargeMemoRef: z.string().min(1).max(200),
      chargeMemoDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      notes: z.string().max(2000).optional(),
    }).parse(req.body);
    const c = await mustCase(ctx.tenantId, caseId);
    const to = await transition(c, "issue_charge_memo", ctx.actorId,
      { chargeMemoRef: body.chargeMemoRef, chargeMemoDate: body.chargeMemoDate }, body.notes ?? null, ctx, req);
    return reply.send({ id: caseId, status: to });
  });

  app.post("/v1/hrms/disciplinary-cases/:caseId/inquiry", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VIGILANCE_ROLES);
    const { caseId } = caseParam.parse(req.params);
    const body = z.object({
      inquiryOfficerId: z.string().uuid().optional(),
      inquiryOfficerName: z.string().min(1).max(200),
      inquiryAppointedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      notes: z.string().max(2000).optional(),
    }).parse(req.body);
    const c = await mustCase(ctx.tenantId, caseId);
    const to = await transition(c, "appoint_inquiry", ctx.actorId, {
      inquiryOfficerName: body.inquiryOfficerName,
      inquiryAppointedDate: body.inquiryAppointedDate,
      ...(body.inquiryOfficerId ? { inquiryOfficerId: body.inquiryOfficerId } : {}),
    }, body.notes ?? null, ctx, req);
    return reply.send({ id: caseId, status: to });
  });

  app.post("/v1/hrms/disciplinary-cases/:caseId/finding", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VIGILANCE_ROLES);
    const { caseId } = caseParam.parse(req.params);
    const body = z.object({
      finding: z.enum(["guilty", "not_guilty", "partly_guilty"]),
      findingNotes: z.string().max(8000).optional(),
      findingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).parse(req.body);
    const c = await mustCase(ctx.tenantId, caseId);
    const to = await transition(c, "record_finding", ctx.actorId, {
      finding: body.finding, findingDate: body.findingDate,
      ...(body.findingNotes ? { findingNotes: body.findingNotes } : {}),
    }, body.findingNotes ?? null, ctx, req);
    return reply.send({ id: caseId, status: to, finding: body.finding });
  });

  app.post("/v1/hrms/disciplinary-cases/:caseId/penalty", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { caseId } = caseParam.parse(req.params);
    const body = z.object({
      penaltyType: z.string().min(1).max(48),
      penaltyDetail: z.string().max(2000).optional(),
      penaltyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      notes: z.string().max(2000).optional(),
    }).parse(req.body);
    const c = await mustCase(ctx.tenantId, caseId);
    const pclass = penaltyClassOf(body.penaltyType);
    if (!pclass) {
      throw new HttpError(400, "UNKNOWN_PENALTY",
        `unknown penalty '${body.penaltyType}'. minor: [${[...MINOR_PENALTIES].join(", ")}]; major: [${[...MAJOR_PENALTIES].join(", ")}]`);
    }
    // A major penalty cannot be imposed in a minor proceeding.
    if (c.proceedingType === "minor" && pclass === "major") {
      throw new HttpError(409, "PENALTY_MISMATCH", "a major penalty cannot be imposed in a minor proceeding");
    }
    const to = await transition(c, "impose_penalty", ctx.actorId, {
      penaltyClass: pclass, penaltyType: body.penaltyType, penaltyDate: body.penaltyDate,
      ...(body.penaltyDetail ? { penaltyDetail: body.penaltyDetail } : {}),
    }, body.notes ?? null, ctx, req);
    return reply.send({ id: caseId, status: to, penaltyClass: pclass, penaltyType: body.penaltyType });
  });

  // eOffice loop — submit a PROPOSED penalty for administrative approval. Rather
  // than imposing the penalty directly (POST .../penalty), this validates the
  // proposed penalty + state and publishes a command that moves the case to
  // `pending_approval`. The eFile is raised against the case id (source_ref_type
  // "hr_disciplinary"); the decision returns on hrms.disciplinary.file_decided
  // and is applied by the eoffice-consumer.
  app.post("/v1/hrms/disciplinary/:id/submit-approval", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      penaltyType: z.string().min(1).max(48),
      penaltyDetail: z.string().max(2000).optional(),
      penaltyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      notes: z.string().max(2000).optional(),
    }).parse(req.body);
    const c = await mustCase(ctx.tenantId, id);
    const pclass = penaltyClassOf(body.penaltyType);
    if (!pclass) {
      throw new HttpError(400, "UNKNOWN_PENALTY",
        `unknown penalty '${body.penaltyType}'. minor: [${[...MINOR_PENALTIES].join(", ")}]; major: [${[...MAJOR_PENALTIES].join(", ")}]`);
    }
    // A major penalty cannot be imposed in a minor proceeding.
    if (c.proceedingType === "minor" && pclass === "major") {
      throw new HttpError(409, "PENALTY_MISMATCH", "a major penalty cannot be imposed in a minor proceeding");
    }
    // Validate the case is in a state from which a penalty may be proposed.
    const check = canTransition(
      c.status as CaseStatus, "submit_for_approval", c.proceedingType as "minor" | "major");
    if (!check.ok) throw new HttpError(409, "WRONG_STATE", check.reason ?? "invalid transition");
    const accepted = await commands.submitDisciplinaryForApproval(ctx, id, {
      penaltyType: body.penaltyType, penaltyClass: pclass, penaltyDate: body.penaltyDate,
      ...(body.penaltyDetail ? { penaltyDetail: body.penaltyDetail } : {}),
      ...(body.notes ? { notes: body.notes } : {}),
    });
    return reply.code(202).send(accepted);
  });

  app.post("/v1/hrms/disciplinary-cases/:caseId/appeal", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VIGILANCE_ROLES);
    const { caseId } = caseParam.parse(req.params);
    const body = z.object({
      appealFiledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      appealAuthority: z.string().min(1).max(200),
      notes: z.string().max(2000).optional(),
    }).parse(req.body);
    const c = await mustCase(ctx.tenantId, caseId);
    const to = await transition(c, "file_appeal", ctx.actorId,
      { appealFiledDate: body.appealFiledDate, appealAuthority: body.appealAuthority }, body.notes ?? null, ctx, req);
    return reply.send({ id: caseId, status: to });
  });

  app.post("/v1/hrms/disciplinary-cases/:caseId/appeal-decision", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { caseId } = caseParam.parse(req.params);
    const body = z.object({
      appealOutcome: z.enum(["upheld", "modified", "set_aside"]),
      appealDecidedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      notes: z.string().max(2000).optional(),
    }).parse(req.body);
    const c = await mustCase(ctx.tenantId, caseId);
    const to = await transition(c, "decide_appeal", ctx.actorId,
      { appealOutcome: body.appealOutcome, appealDecidedDate: body.appealDecidedDate }, body.notes ?? null, ctx, req);
    return reply.send({ id: caseId, status: to, appealOutcome: body.appealOutcome });
  });

  app.post("/v1/hrms/disciplinary-cases/:caseId/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { caseId } = caseParam.parse(req.params);
    const body = z.object({ notes: z.string().max(2000).optional() }).parse(req.body ?? {});
    const c = await mustCase(ctx.tenantId, caseId);
    const to = await transition(c, "close", ctx.actorId, { closedAt: new Date() }, body.notes ?? null, ctx, req);
    return reply.send({ id: caseId, status: to });
  });

  app.post("/v1/hrms/disciplinary-cases/:caseId/drop", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { caseId } = caseParam.parse(req.params);
    const body = z.object({ notes: z.string().max(2000).optional() }).parse(req.body ?? {});
    const c = await mustCase(ctx.tenantId, caseId);
    const to = await transition(c, "drop", ctx.actorId, { closedAt: new Date() }, body.notes ?? null, ctx, req);
    return reply.send({ id: caseId, status: to });
  });

  // -------- suspensions --------
  app.post("/v1/hrms/employees/:id/suspensions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      caseId: z.string().uuid().optional(),
      orderRef: z.string().max(200).optional(),
      fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      paySuspended: z.boolean().default(true),
      subsistencePct: z.coerce.number().min(0).max(100).default(50),
      remarks: z.string().max(2000).optional(),
    }).parse(req.body);
    await mustEmployee(ctx.tenantId, id);
    // H1: at most one ACTIVE suspension per employee (deterministic subsistence%).
    // Friendly pre-check; the DB partial unique index + repo 23505->409 handle races.
    if (await repo.hasActiveSuspension(ctx.tenantId, id)) {
      throw new HttpError(
        409, "ACTIVE_SUSPENSION_EXISTS",
        "employee already has an active suspension; revoke it before creating another",
      );
    }
    const suspId = randomUUID();
    await repo.insertSuspension(db, {
      id: suspId, tenantId: ctx.tenantId, employeeId: id,
      fromDate: body.fromDate, paySuspended: body.paySuspended,
      subsistencePct: body.subsistencePct.toFixed(2), status: "active",
      ...(body.caseId ? { caseId: body.caseId } : {}),
      ...(body.orderRef ? { orderRef: body.orderRef } : {}),
      ...(body.toDate ? { toDate: body.toDate } : {}),
      ...(body.remarks ? { remarks: body.remarks } : {}),
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    return reply.code(201).send({
      id: suspId, employeeId: id, status: "active",
      paySuspended: body.paySuspended, subsistencePct: body.subsistencePct,
    });
  });

  app.get("/v1/hrms/employees/:id/suspensions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VIGILANCE_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send({ data: await repo.listSuspensionsByEmployee(ctx.tenantId, id) });
  });

  app.post("/v1/hrms/suspensions/:suspId/revoke", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { suspId } = suspParam.parse(req.params);
    const body = z.object({
      revokedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      remarks: z.string().max(2000).optional(),
    }).parse(req.body);
    const s = await repo.findSuspension(ctx.tenantId, suspId);
    if (!s) throw new HttpError(404, "NOT_FOUND", "suspension not found");
    if (s.status !== "active") throw new HttpError(409, "WRONG_STATE", `suspension is '${s.status}', not active`);
    await publishF3Write(ctx, "disciplinary_routes__2", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id: suspId, status: "revoked" }) as any;
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
}
