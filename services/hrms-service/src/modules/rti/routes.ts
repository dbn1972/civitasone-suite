import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import type { RequestContext } from "@civitasone/types";
import {
  fileRtiBody, assignPioBody, respondRtiBody, appealRtiBody, closeRtiBody, idParam,
} from "./validators.js";
import * as repo from "./repo.js";
import type { RtiRow } from "./schema.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];

// GAP-HR-RTI-03 (DPDP decision, published packet default: "restrict
// applicant identity to the assigned PIO plus hr_admin"): everyone in
// HR_ROLES may reach this register (it is the workflow surface for the
// whole RTI Act intake/assign/respond/appeal/close cycle), but a plain
// hr_officer who is not the request's own assigned PIO no longer sees the
// applicant's name/contact -- treated the same as hr_admin for this
// purpose (a platform-wide administrator, not a citizen-facing PIO role).
const FULL_IDENTITY_ROLES = ["hr_admin", "super_admin"];

// Exported for rti/routes.test.ts -- these are pure functions (no DB/Fastify
// dependency) that carry this gap's actual security/statutory-deadline
// logic, so they are unit-tested directly rather than only indirectly via a
// full route/DB integration test.
export function canSeeApplicantIdentity(ctx: RequestContext, row: Pick<RtiRow, "pioId">): boolean {
  if (FULL_IDENTITY_ROLES.some((r) => ctx.roles.includes(r))) return true;
  return row.pioId != null && row.pioId === ctx.actorId;
}

// GAP-HR-RTI-06: `today` was computed in UTC (`toISOString()`), so from
// 00:00 to 05:30 IST (UTC+5:30) the server's "today" was still yesterday --
// overdue flipped, and daysToDue read one higher, 5.5 hours late every
// single day. Statutory deadline tracking (RTI Act 2005) should use the
// tenant's actual civil day, not UTC's.
export function todayIst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

// SLA: open (not responded/closed) requests are overdue once today > due_date.
export function withSla(row: RtiRow): RtiRow & { overdue: boolean; daysToDue: number } {
  const today = todayIst();
  const open = row.status === "filed" || row.status === "assigned";
  const msPerDay = 86_400_000;
  const daysToDue = Math.round((Date.parse(row.dueDate) - Date.parse(today)) / msPerDay);
  return { ...row, overdue: open && today > row.dueDate, daysToDue };
}

/**
 * GAP-HR-RTI-03: list DTO projection. Drops applicantContact/requestText/
 * responseText/appealText entirely (over-fetch fix -- the register table
 * never rendered them, only applicantName/subject/dates/status) and masks
 * applicantName to `null` (the web renders "Restricted" for a null name,
 * per the catalog's own fix step -- not a pseudonym, which the decision
 * packet left as an open question, not a confirmed default) unless the
 * caller may see it.
 */
export function projectRtiListRow(row: RtiRow & { overdue: boolean; daysToDue: number }, ctx: RequestContext) {
  const canSeeIdentity = canSeeApplicantIdentity(ctx, row);
  return {
    id: row.id,
    referenceNo: row.referenceNo,
    applicantName: canSeeIdentity ? row.applicantName : null,
    subject: row.subject,
    receivedDate: row.receivedDate,
    dueDate: row.dueDate,
    status: row.status,
    pioId: row.pioId,
    overdue: row.overdue,
    daysToDue: row.daysToDue,
  };
}

/**
 * GAP-HR-RTI-03: detail projection. Unlike the list, this keeps
 * requestText/responseText/appealText/applicantContact -- an assigning
 * officer or supervisor genuinely needs the request's own content to route
 * or review it (this is need-to-know for the workflow itself, not the
 * applicant's *identity*, which is what the decision packet's default is
 * about). applicantName/applicantContact are masked the same way as the
 * list, applied consistently everywhere identity would otherwise appear.
 */
export function projectRtiDetail(row: RtiRow & { overdue: boolean; daysToDue: number }, ctx: RequestContext) {
  const canSeeIdentity = canSeeApplicantIdentity(ctx, row);
  return {
    ...row,
    applicantName: canSeeIdentity ? row.applicantName : null,
    applicantContact: canSeeIdentity ? row.applicantContact : null,
  };
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const listRtiQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).default(200),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export async function rtiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/rti/requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    // GAP-HR-RTI-05: limit/offset (was always limit=200, offset=0 -- older
    // requests silently dropped off both the register and the stat cards
    // once a tenant passed 200 total). hasMore mirrors the same
    // rows.length === limit convention employee/queries.ts already uses.
    const q = listRtiQuery.parse(req.query);
    const rows = await repo.listRti(ctx.tenantId, q.limit, q.offset);
    const withSlaRows = rows.map(withSla);
    return reply.send({
      data: withSlaRows.map((r) => projectRtiListRow(r, ctx)),
      hasMore: rows.length === q.limit,
    });
  });

  // GAP-HR-RTI-02/05: whole-tenant counts (not just this page's rows) so the
  // stat cards -- specifically "Under appeal", which never had a card at
  // all before this -- stay correct past the 200-row list cap.
  app.get("/v1/hrms/rti/requests/summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const summary = await repo.getRtiSummary(ctx.tenantId, todayIst());
    return reply.send({ data: summary });
  });

  app.get("/v1/hrms/rti/requests/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.getRti(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "RTI request not found");
    return reply.send({ data: projectRtiDetail(withSla(row), ctx) });
  });

  // File a new RTI request — computes the 30-day SLA due date.
  app.post("/v1/hrms/rti/requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = fileRtiBody.parse(req.body);
    const id = randomUUID();
    const dueDate = addDays(body.receivedDate, body.slaDays);
    await publishF3Write(ctx, "rti_routes__0", id, {
      body: { ...(req.body as Record<string, unknown>), dueDate },
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
    });
    return reply.code(202).send({ id, status: "accepted", dueDate }) as any;
  });

  // Assign a PIO (filed -> assigned).
  app.post("/v1/hrms/rti/requests/:id/assign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = assignPioBody.parse(req.body);
    const existing = await repo.getRti(ctx.tenantId, id);
    if (!existing || existing.status !== "filed") {
      throw new HttpError(409, "INVALID_STATE", "request must be 'filed' to assign a PIO");
    }
    await publishF3Write(ctx, "rti_routes__1", id, {
      body: { ...(req.body as Record<string, unknown>), from: ["filed"], to: "assigned" },
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
    });
    return reply.code(202).send({ id, status: "accepted", pioId: body.pioId }) as any;
  });

  // PIO responds (filed|assigned -> responded).
  app.post("/v1/hrms/rti/requests/:id/respond", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = respondRtiBody.parse(req.body);
    const existing = await repo.getRti(ctx.tenantId, id);
    if (!existing || (existing.status !== "filed" && existing.status !== "assigned")) {
      throw new HttpError(409, "INVALID_STATE", "request must be open to respond");
    }
    await publishF3Write(ctx, "rti_routes__2", id, {
      body: { ...(req.body as Record<string, unknown>), from: ["filed", "assigned"], to: "responded" },
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
    });
    return reply.code(202).send({ id, status: "accepted" }) as any;
  });

  // First appeal (responded -> appealed).
  app.post("/v1/hrms/rti/requests/:id/appeal", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = appealRtiBody.parse(req.body);
    const existing = await repo.getRti(ctx.tenantId, id);
    if (!existing || existing.status !== "responded") {
      throw new HttpError(409, "INVALID_STATE", "only a responded request can be appealed");
    }
    await publishF3Write(ctx, "rti_routes__3", id, {
      body: { ...(req.body as Record<string, unknown>), from: ["responded"], to: "appealed" },
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
    });
    return reply.code(202).send({ id, status: "accepted" }) as any;
  });

  // Close (responded|appealed -> closed).
  app.post("/v1/hrms/rti/requests/:id/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = closeRtiBody.parse(req.body);
    const existing = await repo.getRti(ctx.tenantId, id);
    if (!existing || (existing.status !== "responded" && existing.status !== "appealed")) {
      throw new HttpError(409, "INVALID_STATE", "request must be responded or appealed to close");
    }
    // SoD: closing an APPEALED request is deciding the appeal against the
    // original response. The PIO who handled (was assigned, per pioId) the
    // original request must not also be the one who decides its own appeal.
    // Only applies to the appealed path -- directly closing a merely-
    // "responded" (never appealed) request is the normal single-officer
    // disposal flow and is unaffected.
    if (existing.status === "appealed" && existing.pioId && existing.pioId === ctx.actorId) {
      throw new HttpError(
        403,
        "SEGREGATION_OF_DUTIES",
        "the officer who handled the original request cannot also decide its appeal",
      );
    }
    await publishF3Write(ctx, "rti_routes__4", id, {
      body: { ...(req.body as Record<string, unknown>), from: ["responded", "appealed"], to: "closed" },
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
    });
    return reply.code(202).send({ id, status: "accepted" }) as any;
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
