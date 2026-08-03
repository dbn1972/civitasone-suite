import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Recruitment Requisition routes (checklist "Job requisition", R-RA-0048..0062).
 *
 *   POST  /v1/hrms/requisitions                      create (draft)
 *   GET   /v1/hrms/requisitions[?status=]            list (confidential-aware)
 *   GET   /v1/hrms/requisitions/:id                  read
 *   PATCH /v1/hrms/requisitions/:id                  edit (draft/returned only)
 *   GET   /v1/hrms/requisitions/:id/approvals        approval audit history
 *   POST  /v1/hrms/requisitions/:id/submit           draft/returned -> pending_approval
 *   POST  /v1/hrms/requisitions/:id/approve          advance the approval chain
 *   POST  /v1/hrms/requisitions/:id/return           return for correction (comments)
 *   POST  /v1/hrms/requisitions/:id/hold | /reopen   hold / reopen
 *   POST  /v1/hrms/requisitions/:id/cancel | /close  cancel / close (reason)
 *   POST  /v1/hrms/requisitions/:id/clone            clone into a fresh draft
 *   POST  /v1/hrms/requisitions/:id/publish          approved -> published (job opening)
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import {
  DEFAULT_GOVT_CHAIN, currentStageRole, isFinalStage, canPublish, isEditable, cloneFields, toVacancyType,
  type ApprovalStage,
} from "./requisition-domain.js";
import * as repo from "./requisition-repo.js";
import type { RequisitionRow } from "./requisition-schema.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const ADMIN_ROLES = ["hr_admin", "super_admin"];
const CREATE_ROLES = [...HR_ROLES, "hiring_manager", "manager"];
// Roles that may appear as an approval-chain stage. A chain cannot invent an
// arbitrary role, and a non-privileged creator cannot supply a custom chain at
// all — both defeat the mandatory maker-checker routing otherwise.
const KNOWN_APPROVER_ROLES = new Set([
  "hiring_manager", "hr_admin", "hr_officer", "finance_officer",
  "competent_authority", "department_head", "super_admin",
]);

function validateChain(chain: ApprovalStage[]): void {
  if (!Array.isArray(chain) || chain.length === 0) {
    throw new HttpError(400, "INVALID_CHAIN", "approval chain must have at least one stage");
  }
  for (const s of chain) {
    if (!KNOWN_APPROVER_ROLES.has(s.role)) {
      throw new HttpError(400, "INVALID_CHAIN_ROLE", `unknown approver role '${s.role}'`);
    }
  }
  // A multi-stage chain must involve more than one approver FUNCTION — this
  // blocks a degenerate rubber-stamp chain (e.g. [hr_admin, hr_admin]) that,
  // combined with segregation of duties, would otherwise just need two people of
  // the same function. NOTE: mandatory-stage COVERAGE for a given org type (e.g.
  // Government hiring must include Finance + Competent Authority, R-RA-0053) is an
  // org-policy concern enforced by the DEFAULT_GOVT_CHAIN and org onboarding, not
  // hard-coded here — the module also serves PSU / Section-8 / private tenants
  // whose legitimate chains differ.
  if (chain.length > 1 && new Set(chain.map((s) => s.role)).size < 2) {
    throw new HttpError(400, "INVALID_CHAIN", "a multi-stage approval chain must involve more than one approver role");
  }
}

const idParam = z.object({ id: z.string().uuid() });
const stageSchema = z.array(z.object({ stage: z.string().min(1).max(64), role: z.string().min(1).max(48) })).max(10);

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

const reqBody = z.object({
  title: z.string().min(1).max(200),
  positionId: z.string().uuid().optional(),
  sourceManpowerReqId: z.string().uuid().optional(),
  reason: z.string().max(4000).optional(),
  employmentType: z.string().min(1).max(24).default("permanent"),
  recruitmentMode: z.enum(["direct", "deputation", "absorption", "promotion", "contract", "consultant"]).default("direct"),
  campaignType: z.enum(["direct", "campus", "walkin", "referral", "lateral", "apprenticeship", "mass"]).default("direct"),
  departmentId: z.string().uuid().optional(),
  designationId: z.string().uuid().optional(),
  grade: z.string().max(48).optional(),
  location: z.string().max(200).optional(),
  vacancies: z.coerce.number().int().positive().default(1),
  experienceMinYears: z.coerce.number().int().min(0).max(60).default(0),
  qualification: z.string().max(1000).optional(),
  skills: z.string().max(4000).optional(),
  reservation: z.record(z.coerce.number().int().min(0)).default({}),
  budgetMinor: z.coerce.number().int().min(0).optional(),
  confidential: z.boolean().default(false),
  agencyId: z.string().uuid().optional(),
  targetHireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  slaDays: z.coerce.number().int().min(0).max(3650).optional(),
  approvalChain: stageSchema.optional(),
});

export async function requisitionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/requisitions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CREATE_ROLES);
    const b = reqBody.parse(req.body);
    const id = randomUUID();
    // Only privileged (HR/super) admins may supply a custom approval chain — a
    // hiring manager cannot route their own requisition through a chain of their
    // own choosing. Everyone else gets the mandatory default government chain.
    const privileged = ctx.roles.some((r: string) => ADMIN_ROLES.includes(r));
    if (b.approvalChain && !privileged) throw new HttpError(403, "CHAIN_NOT_ALLOWED", "only HR admins may set a custom approval chain");
    const chain: ApprovalStage[] = b.approvalChain ?? DEFAULT_GOVT_CHAIN;
    validateChain(chain);
    await publishF3Write(ctx, "recruitment_requisition_routes__0", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id, requisitionNo: reqNo(id), status: "draft" });
    function reqNo(x: string) { return `REQ-${x.slice(0, 8).toUpperCase()}`; }
  });

  app.get("/v1/hrms/requisitions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CREATE_ROLES);
    const q = z.object({ status: z.string().max(20).optional() }).parse(req.query);
    const privileged = ctx.roles.some((r: string) => ADMIN_ROLES.includes(r));
    return reply.send(jsonSafe({ data: await repo.listRequisitions(ctx.tenantId, { ...(q.status ? { status: q.status } : {}), privileged, viewerId: ctx.actorId }) }));
  });

  app.get("/v1/hrms/requisitions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CREATE_ROLES);
    const { id } = idParam.parse(req.params);
    const r = await mustReq(ctx.tenantId, id);
    assertCanView(ctx, r);
    return reply.send(jsonSafe(r));
  });

  app.get("/v1/hrms/requisitions/:id/approvals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CREATE_ROLES);
    const { id } = idParam.parse(req.params);
    const r = await mustReq(ctx.tenantId, id);
    assertCanView(ctx, r);
    return reply.send(jsonSafe({ data: await repo.listApprovals(ctx.tenantId, id) }));
  });

  app.patch("/v1/hrms/requisitions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CREATE_ROLES);
    const { id } = idParam.parse(req.params);
    const r = await mustReq(ctx.tenantId, id);
    assertCanView(ctx, r); // a confidential requisition cannot be edited (or un-hidden) by a non-privileged non-creator
    if (!isEditable(r.status)) throw new HttpError(409, "WRONG_STATE", `requisition is '${r.status}'; only draft/returned are editable`);
    const b = reqBody.partial().parse(req.body ?? {});
    const patch: Record<string, unknown> = { updatedBy: ctx.actorId };
    for (const k of ["title", "reason", "employmentType", "recruitmentMode", "campaignType", "grade", "location",
      "vacancies", "experienceMinYears", "qualification", "skills", "reservation", "confidential", "targetHireDate", "slaDays"] as const) {
      if ((b as Record<string, unknown>)[k] !== undefined) patch[k] = (b as Record<string, unknown>)[k];
    }
    if (b.budgetMinor != null) patch.budgetMinor = BigInt(b.budgetMinor);
    if (b.approvalChain !== undefined) {
      const privileged = ctx.roles.some((role: string) => ADMIN_ROLES.includes(role));
      if (!privileged) throw new HttpError(403, "CHAIN_NOT_ALLOWED", "only HR admins may change the approval chain");
      validateChain(b.approvalChain);
      patch.approvalChain = b.approvalChain;
    }
    await publishF3Write(ctx, "recruitment_requisition_routes__1", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: r.status });
  });

  app.post("/v1/hrms/requisitions/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CREATE_ROLES);
    const { id } = idParam.parse(req.params);
    const r = await mustReq(ctx.tenantId, id);
    if (r.status !== "draft" && r.status !== "returned") throw new HttpError(409, "WRONG_STATE", `requisition is '${r.status}', cannot submit`);
    const chain = r.approvalChain as ApprovalStage[];
    if (!Array.isArray(chain) || chain.length === 0) throw new HttpError(400, "NO_APPROVAL_CHAIN", "requisition has no approval chain configured");
    await publishF3Write(ctx, "recruitment_requisition_routes__2", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({ id, status: "pending_approval", currentStage: 0 }));
  });

  app.post("/v1/hrms/requisitions/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = idParam.parse(req.params);
    const body = z.object({ comments: z.string().max(2000).optional() }).parse(req.body ?? {});
    const r = await mustReq(ctx.tenantId, id);
    if (r.status !== "pending_approval") throw new HttpError(409, "WRONG_STATE", `requisition is '${r.status}', not pending approval`);
    const chain = r.approvalChain as ApprovalStage[];
    const role = currentStageRole(chain, r.currentStage);
    if (!role) throw new HttpError(409, "NO_STAGE", "no active approval stage");
    // Only the role configured for the current stage (or super_admin) may act.
    requireRole(ctx, [role, "super_admin"]);
    // Segregation of duties (maker-checker): the requisition's creator can never
    // approve their own requisition, and no single person may clear more than one
    // stage — so an N-stage chain requires N distinct, non-creator approvers.
    if (r.createdBy === ctx.actorId) {
      throw new HttpError(409, "SOD_VIOLATION", "the requisition creator cannot approve their own requisition");
    }
    if (await repo.actorAlreadyApproved(ctx.tenantId, id, ctx.actorId, r.submittedAt as Date | null)) {
      throw new HttpError(409, "SOD_VIOLATION", "you have already approved an earlier stage of this requisition");
    }
    const final = isFinalStage(chain, r.currentStage);
    await publishF3Write(ctx, "recruitment_requisition_routes__3", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({ id, status: final ? "approved" : "pending_approval", currentStage: final ? r.currentStage : r.currentStage + 1 }));
  });

  app.post("/v1/hrms/requisitions/:id/return", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = idParam.parse(req.params);
    const body = z.object({ comments: z.string().min(1).max(2000) }).parse(req.body ?? {}); // mandatory (R-RA-0054)
    const r = await mustReq(ctx.tenantId, id);
    if (r.status !== "pending_approval") throw new HttpError(409, "WRONG_STATE", `requisition is '${r.status}', not pending approval`);
    const chain = r.approvalChain as ApprovalStage[];
    const role = currentStageRole(chain, r.currentStage);
    if (!role) throw new HttpError(409, "NO_STAGE", "no active approval stage");
    requireRole(ctx, [role, "super_admin"]);
    await publishF3Write(ctx, "recruitment_requisition_routes__4", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({ id, status: "returned" }));
  });

  app.post("/v1/hrms/requisitions/:id/hold", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ reason: z.string().min(1).max(2000) }).parse(req.body ?? {});
    const r = await mustReq(ctx.tenantId, id);
    if (r.status !== "pending_approval" && r.status !== "approved") throw new HttpError(409, "WRONG_STATE", `requisition is '${r.status}', cannot hold`);
    await publishF3Write(ctx, "recruitment_requisition_routes__5", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({ id, status: "on_hold" }));
  });

  app.post("/v1/hrms/requisitions/:id/reopen", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const r = await mustReq(ctx.tenantId, id);
    if (r.status !== "on_hold") throw new HttpError(409, "WRONG_STATE", `requisition is '${r.status}', not on hold`);
    // Restore to where it was: fully approved runs resume 'approved', else back to pending.
    const restored = r.approvedAt ? "approved" : "pending_approval";
    await publishF3Write(ctx, "recruitment_requisition_routes__6", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({ id, status: restored }));
  });

  app.post("/v1/hrms/requisitions/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ reason: z.string().min(1).max(2000) }).parse(req.body ?? {});
    const r = await mustReq(ctx.tenantId, id);
    if (r.status === "published" || r.status === "cancelled" || r.status === "closed") {
      throw new HttpError(409, "WRONG_STATE", `requisition is '${r.status}', cannot cancel`);
    }
    await publishF3Write(ctx, "recruitment_requisition_routes__7", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({ id, status: "cancelled" }));
  });

  app.post("/v1/hrms/requisitions/:id/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ reason: z.string().min(1).max(2000) }).parse(req.body ?? {});
    const r = await mustReq(ctx.tenantId, id);
    if (r.status !== "approved" && r.status !== "published" && r.status !== "on_hold") {
      throw new HttpError(409, "WRONG_STATE", `requisition is '${r.status}', cannot close`);
    }
    await publishF3Write(ctx, "recruitment_requisition_routes__8", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({ id, status: "closed" }));
  });

  app.post("/v1/hrms/requisitions/:id/clone", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CREATE_ROLES);
    const { id } = idParam.parse(req.params);
    const r = await mustReq(ctx.tenantId, id);
    assertCanView(ctx, r);
    const newId = randomUUID();
    const carried = cloneFields(r as unknown as Record<string, unknown>);
    await publishF3Write(ctx, "recruitment_requisition_routes__9", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: newId, clonedFrom: id, status: "draft" });
  });

  app.post("/v1/hrms/requisitions/:id/publish", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const r = await mustReq(ctx.tenantId, id);
    // R-RA-0056: publication is blocked until the requisition is fully approved.
    if (!canPublish(r.status)) throw new HttpError(409, "NOT_APPROVED", `requisition is '${r.status}', not fully approved — cannot publish`);
    if (!r.departmentId) throw new HttpError(400, "MISSING_DEPARTMENT", "a department is required to publish a job opening");
    const openingId = randomUUID();
    await publishF3Write(ctx, "recruitment_requisition_routes__10", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({ id, status: "published", publishedOpeningId: openingId }));
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

  async function mustReq(tenantId: string, id: string): Promise<RequisitionRow> {
    const r = await repo.findRequisition(tenantId, id);
    if (!r) throw new HttpError(404, "NOT_FOUND", "requisition not found");
    return r;
  }
  function assertCanView(ctx: { roles: string[]; actorId: string }, r: RequisitionRow): void {
    if (!r.confidential) return;
    const privileged = ctx.roles.some((role) => ADMIN_ROLES.includes(role));
    if (!privileged && r.createdBy !== ctx.actorId) {
      throw new HttpError(404, "NOT_FOUND", "requisition not found"); // hide existence of confidential reqs
    }
  }
}
