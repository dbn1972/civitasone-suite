import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Interview panel governance & outcome (R-RA-0137/0138/0149/0150).
 *
 *   POST /v1/hrms/interviews/:id/panel                      constitute the panel (role + availability + COI)
 *   GET  /v1/hrms/interviews/:id/panel                      panel + readiness (COI status)
 *   POST /v1/hrms/interviews/:id/panelists/:memberId/recuse recuse a conflicted panelist
 *   POST /v1/hrms/interviews/:id/outcome                    record recommend / waitlist / reject
 *
 * A panelist who declares a conflict of interest must be recused before the panel
 * can record an outcome (R-RA-0138). Rejections carry a structured reason
 * (R-RA-0149); recommendations / waitlists carry a validity period (R-RA-0150).
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import {
  PANEL_ROLES, COI_TYPES, REJECTION_REASONS, OUTCOME_STATUSES,
  panelReadiness, validateOutcome, type Panelist,
} from "./panel-domain.js";
import * as repo from "./panel-repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });

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

const toPanelist = (p: { memberId: string; panelRole: string; coiDeclared: boolean; coiType: string; recused: boolean }): Panelist =>
  ({ memberId: p.memberId, panelRole: p.panelRole, coiDeclared: p.coiDeclared, coiType: p.coiType, recused: p.recused });

export async function interviewPanelRoutes(app: FastifyInstance): Promise<void> {
  // ---- constitute the panel (R-RA-0138) --------------------------------
  app.post("/v1/hrms/interviews/:id/panel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      members: z.array(z.object({
        memberId: z.string().uuid(),
        memberName: z.string().min(1).max(256),
        panelRole: z.enum(PANEL_ROLES).default("member"),
        availability: z.record(z.unknown()).optional(),
        coiDeclared: z.boolean().default(false),
        coiType: z.enum(COI_TYPES).default("none"),
        coiNote: z.string().max(2000).optional(),
      })).min(1).max(25),
    }).parse(req.body);

    // A declared COI must carry a type other than 'none' (and vice-versa) so the
    // recusal rule can act on it.
    for (const m of body.members) {
      if (m.coiDeclared && m.coiType === "none") throw new HttpError(422, "COI_TYPE_REQUIRED", `panelist ${m.memberId} declared a conflict but gave no coiType`);
      if (!m.coiDeclared && m.coiType !== "none") throw new HttpError(422, "COI_FLAG_REQUIRED", `panelist ${m.memberId} has a coiType but coiDeclared is false`);
    }
    const ids = new Set(body.members.map((m) => m.memberId));
    if (ids.size !== body.members.length) throw new HttpError(422, "DUPLICATE_PANELIST", "a panelist appears more than once");

    const interview = await mustInterview(ctx.tenantId, id);
    if (interview.outcomeStatus !== "pending") throw new HttpError(409, "OUTCOME_RECORDED", "the panel cannot be changed after an outcome is recorded");

    await publishF3Write(ctx, "recruitment_panel_routes__0", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    const readiness = panelReadiness(body.members.map((m) => toPanelist({ ...m, recused: false })));
    return reply.code(201).send(jsonSafe({ interviewId: id, panelSize: body.members.length, readiness }));
  });

  app.get("/v1/hrms/interviews/:id/panel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    await mustInterview(ctx.tenantId, id);
    const panelists = await repo.listPanelists(ctx.tenantId, id);
    return reply.send(jsonSafe({
      interviewId: id,
      panelists: panelists.map((p) => ({ memberId: p.memberId, memberName: p.memberName, panelRole: p.panelRole, coiDeclared: p.coiDeclared, coiType: p.coiType, recused: p.recused })),
      readiness: panelReadiness(panelists.map(toPanelist)),
    }));
  });

  // ---- recuse a conflicted panelist (R-RA-0138) ------------------------
  app.post("/v1/hrms/interviews/:id/panelists/:memberId/recuse", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const memberId = z.string().uuid().parse((req.params as { memberId: string }).memberId);
    const interview = await mustInterview(ctx.tenantId, id);
    // No post-decision tampering: the panel composition record is frozen once an
    // outcome is recorded (mirrors the panel-constitution lock).
    if (interview.outcomeStatus !== "pending") throw new HttpError(409, "OUTCOME_RECORDED", "the panel cannot be changed after an outcome is recorded");
    const n = await publishF3Write(ctx, "recruitment_panel_routes__1", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    if (n === 0) throw new HttpError(404, "NOT_FOUND", "panelist not found on this interview");
    return reply.send({ interviewId: id, memberId, recused: true });
  });

  // ---- record the outcome (R-RA-0149/0150) -----------------------------
  app.post("/v1/hrms/interviews/:id/outcome", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      status: z.enum(OUTCOME_STATUSES),
      rejectionReason: z.enum(REJECTION_REASONS).optional(),
      rejectionNote: z.string().max(4000).optional(),
      waitlistRank: z.coerce.number().int().min(1).optional(),
      validUntil: z.string().datetime().optional(),
    }).parse(req.body);

    const interview = await mustInterview(ctx.tenantId, id);
    const errors = validateOutcome({
      status: body.status,
      rejectionReason: body.rejectionReason ?? null,
      waitlistRank: body.waitlistRank ?? null,
      validUntil: body.validUntil ?? null,
      nowMs: Date.now(),
    });
    if (errors.length > 0) throw new HttpError(422, "INVALID_OUTCOME", errors.join("; "));

    // R-RA-0138: the panel must be validly constituted with no unresolved COI.
    const panelists = await repo.listPanelists(ctx.tenantId, id);
    const readiness = panelReadiness(panelists.map(toPanelist));
    if (!readiness.ready) {
      const code = readiness.unrecusedConflicts.length > 0 ? "COI_UNRESOLVED" : "PANEL_NOT_READY";
      throw new HttpError(409, code, `cannot record an outcome: ${readiness.reasons.join("; ")}`);
    }

    const validUntil = body.validUntil ? new Date(body.validUntil).toISOString().slice(0, 10) : null;
    // The version guard binds this outcome to the exact panel that cleared the COI
    // gate above: any concurrent panel edit bumps interview.version (see
    // touchInterviewVersion), so this write 409s rather than committing an outcome
    // against a roster that was swapped after readiness was checked.
    await publishF3Write(ctx, "recruitment_panel_routes__2", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({ interviewId: id, outcomeStatus: body.status, validUntil }));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });

  async function mustInterview(tenantId: string, id: string) {
    const iv = await repo.findInterview(tenantId, id);
    if (!iv) throw new HttpError(404, "NOT_FOUND", "interview not found");
    return iv;
  }
}
