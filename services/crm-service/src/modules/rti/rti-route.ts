/**
 * RTI Act 2005 — route handlers.
 *
 * Endpoints:
 *   POST   /v1/crm/rti                    — log a new RTI request
 *   GET    /v1/crm/rti                    — list with filters + SLA ordering
 *   GET    /v1/crm/rti/:id               — detail
 *   PATCH  /v1/crm/rti/:id/forward       — transfer to another department
 *   PATCH  /v1/crm/rti/:id/respond       — respond within 30-day statutory deadline
 *   PATCH  /v1/crm/rti/:id/first-appeal  — trigger first-appeal (s.19 RTI Act)
 *   PATCH  /v1/crm/rti/:id/first-appeal/decide — record the FAA's order (admin)
 *   PATCH  /v1/crm/rti/:id/second-appeal — record a second appeal (s.19(3))
 *   PATCH  /v1/crm/rti/:id/dispose       — close the request with a reason (admin)
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { listQuery, windowOf, listEnvelope } from "../../shared/list-query.js";
import * as repo from "./rti-repo.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];

const RTI_STATUS = repo.RTI_STATUS;
const RTI_SECTIONS = ["s.6", "s.11"] as const;

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const RTI_MODES = ["online", "post", "email", "in_person", "by_hand"] as const;

const createBody = z.object({
  section: z.enum(RTI_SECTIONS),
  departmentRef: z.string().min(1).max(200),
  applicantName: z.string().min(1).max(200),
  applicantContact: z.string().max(200).optional(),
  subject: z.string().min(1).max(500),
  description: z.string().min(1).max(10000),
  feePaid: z.boolean().default(false),
  feeAmount: z.number().nonnegative().optional(),
  // GAP-CRM-RTI-NEW-01: money travels as bigint minor units (paise), per
  // CLAUDE.md §3.11. Preferred over the legacy rupees `feeAmount` number.
  // Accepted as an integer or an integer string (bigint-safe over the wire).
  feeAmountMinor: z
    .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)])
    .optional(),
  // GAP-CRM-RTI-NEW-02: date the request was physically received. The 30-day
  // statutory clock (the generated due_at column) runs from this, not from
  // when the register entry is filed. A bare "YYYY-MM-DD" calendar date; the
  // server resolves it to UTC midnight so due_at = receivedDate + 30 days
  // matches the generated column's UTC basis. Omitted -> server now().
  receivedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "receivedDate must be an ISO calendar date (YYYY-MM-DD)").optional(),
  // Mode of receipt (how the request arrived). Optional for backward compat.
  mode: z.enum(RTI_MODES).optional(),
});

const listParams = listQuery.extend({
  status: z.enum(RTI_STATUS).optional(),
  section: z.enum(RTI_SECTIONS).optional(),
  departmentRef: z.string().max(200).optional(),
  search: z.string().max(200).optional(),
});

const idParam = z.object({ id: z.string().uuid() });
const forwardBody = z.object({ departmentRef: z.string().min(1).max(200) });
const respondBody = z.object({ responseText: z.string().min(1).max(10000) });

// GAP-CRM-RTI-DETAIL-01: appeal-chain bodies. Free text that becomes part of
// the statutory record must be substantive (min 20 chars), matching the web.
const RTI_APPELLATE_ROLES = ["crm_admin", "super_admin", "tenant_admin"];
const decideBody = z.object({
  outcome: z.enum(repo.FIRST_APPEAL_OUTCOMES),
  orderText: z.string().trim().min(20).max(10000),
});
const secondAppealBody = z.object({ reference: z.string().trim().min(3).max(500) });
const disposeBody = z.object({ reason: z.string().trim().min(20).max(2000) });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build reference: RTI/YYYY/DEPT/NNNNNN */
function rtiRef(departmentRef: string): string {
  const yr = new Date().getFullYear();
  const dept = departmentRef
    .slice(0, 6)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "X");
  const suffix = Date.now().toString(36).toUpperCase().slice(-6);
  return `RTI/${yr}/${dept}/${suffix}`;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function rtiRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/crm/rti — log a new RTI request
  app.post("/v1/crm/rti", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = createBody.parse(req.body);
    const referenceNo = rtiRef(body.departmentRef);

    // Bound fee inputs (would overflow numeric(10,2)/bigint -> 500) and require
    // feeAmount (rupees) / feeAmountMinor (paise) to agree exactly. 422 on failure.
    const fee = repo.resolveFee(body.feeAmount, body.feeAmountMinor);
    if (!fee.ok) throw new HttpError(422, fee.code, fee.message);

    // GAP-CRM-RTI-NEW-02: an RTI cannot have been received in the future. The
    // 30-day statutory clock runs from the date of receipt, so a future date
    // would understate the deadline. Compare calendar dates in UTC (the same
    // basis the generated due_at column uses). Fail closed with 422.
    if (body.receivedDate !== undefined) {
      const todayUtc = new Date().toISOString().slice(0, 10);
      if (body.receivedDate > todayUtc) {
        throw new HttpError(
          422,
          "INVALID_RECEIVED_DATE",
          "receivedDate cannot be in the future",
        );
      }
    }

    const row = await repo.createRti({
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      referenceNo,
      section: body.section,
      departmentRef: body.departmentRef,
      applicantName: body.applicantName,
      ...(body.applicantContact !== undefined ? { applicantContact: body.applicantContact } : {}),
      subject: body.subject,
      description: body.description,
      feePaid: body.feePaid,
      ...(fee.feeAmount !== undefined ? { feeAmount: fee.feeAmount } : {}),
      ...(fee.feeAmountMinor !== undefined ? { feeAmountMinor: fee.feeAmountMinor } : {}),
      ...(body.receivedDate !== undefined ? { receivedDate: body.receivedDate } : {}),
      ...(body.mode !== undefined ? { mode: body.mode } : {}),
    });

    return reply.code(201).send({ data: row });
  });

  // GET /v1/crm/rti — list with filters, ordered by due_at ASC (soonest first)
  app.get("/v1/crm/rti", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listParams.parse(req.query ?? {});
    const w = windowOf(q);

    const { rows, total } = await repo.getRtiList({
      tenantId: ctx.tenantId,
      ...(q.status !== undefined ? { status: q.status } : {}),
      ...(q.section !== undefined ? { section: q.section } : {}),
      ...(q.departmentRef !== undefined ? { departmentRef: q.departmentRef } : {}),
      ...(q.search !== undefined ? { search: q.search } : {}),
      pageSize: w.pageSize,
      offset: w.offset,
    });

    return reply.send(listEnvelope(rows, w, total));
  });

  // GET /v1/crm/rti/:id — detail
  app.get("/v1/crm/rti/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);

    const row = await repo.getRtiById(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "RTI request not found");
    return reply.send({ data: row });
  });

  // PATCH /v1/crm/rti/:id/forward — transfer to another CPIO / department
  app.patch("/v1/crm/rti/:id/forward", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = forwardBody.parse(req.body);

    const row = await repo.forwardRti(
      ctx.tenantId,
      ctx.actorId,
      id,
      body.departmentRef,
    );
    if (!row)
      throw new HttpError(
        404,
        "NOT_FOUND",
        "RTI request not found or already responded/disposed",
      );
    return reply.send({ data: row });
  });

  // PATCH /v1/crm/rti/:id/respond — provide response within 30-day deadline
  app.patch("/v1/crm/rti/:id/respond", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = respondBody.parse(req.body);

    const row = await repo.respondRti(
      ctx.tenantId,
      ctx.actorId,
      id,
      body.responseText,
    );
    if (!row)
      throw new HttpError(
        404,
        "NOT_FOUND",
        "RTI request not found or already disposed",
      );
    return reply.send({ data: row });
  });

  // PATCH /v1/crm/rti/:id/first-appeal — applicant raises first appeal (s.19)
  app.patch("/v1/crm/rti/:id/first-appeal", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);

    const row = await repo.firstAppeal(ctx.tenantId, ctx.actorId, id);
    if (!row)
      throw new HttpError(
        422,
        "INVALID_STATE",
        "First appeal requires the RTI to be in RESPONDED or REJECTED status",
      );
    return reply.send({ data: row });
  });

  // -------------------------------------------------------------------------
  // GAP-CRM-RTI-DETAIL-01: appeal chain. Previously FIRST_APPEAL dead-ended.
  // Deciding an appeal and disposing a request are appellate/closing acts, so
  // they need an admin role (the FAA is not modelled as its own role; a plain
  // crm_user must not be able to decide or close a statutory appeal). Recording
  // that the applicant filed a second appeal is clerical, like first-appeal.
  // -------------------------------------------------------------------------

  // PATCH /v1/crm/rti/:id/first-appeal/decide — record the FAA's order
  app.patch("/v1/crm/rti/:id/first-appeal/decide", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, RTI_APPELLATE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = decideBody.parse(req.body);
    await requireRti(ctx.tenantId, id);

    const row = await repo.decideFirstAppeal(ctx, id, body.outcome, body.orderText);
    if (!row)
      throw new HttpError(
        422,
        "INVALID_STATE",
        "A decision can only be recorded on an undecided first appeal",
      );
    return reply.send({ data: row });
  });

  // PATCH /v1/crm/rti/:id/second-appeal — applicant filed with the Commission (s.19(3))
  app.patch("/v1/crm/rti/:id/second-appeal", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = secondAppealBody.parse(req.body);
    await requireRti(ctx.tenantId, id);

    const row = await repo.recordSecondAppeal(ctx, id, body.reference);
    if (!row)
      throw new HttpError(
        422,
        "INVALID_STATE",
        "A second appeal can only be recorded while the RTI is in FIRST_APPEAL",
      );
    return reply.send({ data: row });
  });

  // PATCH /v1/crm/rti/:id/dispose — close the request with a reason
  app.patch("/v1/crm/rti/:id/dispose", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, RTI_APPELLATE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = disposeBody.parse(req.body);
    await requireRti(ctx.tenantId, id);

    const row = await repo.disposeRti(ctx, id, body.reason);
    if (!row)
      throw new HttpError(
        422,
        "INVALID_STATE",
        "Disposal requires a decided first appeal or a second appeal",
      );
    return reply.send({ data: row });
  });
}

/** 404 (not 422) when the id does not exist for this tenant. */
async function requireRti(tenantId: string, id: string): Promise<void> {
  const existing = await repo.getRtiById(tenantId, id);
  if (!existing) throw new HttpError(404, "NOT_FOUND", "RTI request not found");
}
