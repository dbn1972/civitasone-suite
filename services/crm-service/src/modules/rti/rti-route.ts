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

const createBody = z.object({
  section: z.enum(RTI_SECTIONS),
  departmentRef: z.string().min(1).max(200),
  applicantName: z.string().min(1).max(200),
  applicantContact: z.string().max(200).optional(),
  subject: z.string().min(1).max(500),
  description: z.string().min(1).max(10000),
  feePaid: z.boolean().default(false),
  feeAmount: z.number().nonnegative().optional(),
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

    const row = await repo.createRti({
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      referenceNo,
      section: body.section,
      departmentRef: body.departmentRef,
      applicantName: body.applicantName,
      applicantContact: body.applicantContact,
      subject: body.subject,
      description: body.description,
      feePaid: body.feePaid,
      feeAmount: body.feeAmount,
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
      status: q.status,
      section: q.section,
      departmentRef: q.departmentRef,
      search: q.search,
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
}
