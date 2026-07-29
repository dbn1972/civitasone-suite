/**
 * Candidate ↔ panel conflict-of-interest detection (R-RA-0117).
 *
 *   POST /v1/hrms/interviews/:id/coi-scan   scan a candidate against the interview's constituted panel
 *   POST /v1/hrms/recruitment/coi-scan       scan against an ad-hoc panel (e.g. a screening committee)
 *
 * Detection is advisory — the flags surface potential conflicts for HR review and
 * panelist recusal; they do not auto-decide. Complements the panelist COI
 * DECLARATION + recusal gate in the interview-panel module.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { detectConflicts, type CandidateProfile, type PanelMember } from "./coi-domain.js";
import * as panelRepo from "./panel-repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });

const candidateShape = z.object({
  name: z.string().min(1).max(256),
  email: z.string().max(256).optional(),
  phone: z.string().max(32).optional(),
  institutions: z.array(z.string().max(256)).max(50).optional(),
  address: z.string().max(1000).optional(),
});
const enrichmentShape = z.array(z.object({
  memberId: z.string().uuid(),
  email: z.string().max(256).optional(),
  phone: z.string().max(32).optional(),
  institution: z.string().max(256).optional(),
})).max(50).optional();
const panelMemberShape = z.array(z.object({
  memberId: z.string().uuid(),
  memberName: z.string().min(1).max(256),
  email: z.string().max(256).optional(),
  phone: z.string().max(32).optional(),
  institution: z.string().max(256).optional(),
})).min(1).max(50);

export async function coiRoutes(app: FastifyInstance): Promise<void> {
  // ---- scan against a constituted interview panel -----------------------
  app.post("/v1/hrms/interviews/:id/coi-scan", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ candidate: candidateShape, panelEnrichment: enrichmentShape }).parse(req.body);

    const panelists = await panelRepo.listPanelists(ctx.tenantId, id);
    if (panelists.length === 0) throw new HttpError(409, "NO_PANEL", "the interview has no constituted panel to scan");
    const enrich = new Map((body.panelEnrichment ?? []).map((e) => [e.memberId, e]));
    const panel: PanelMember[] = panelists.map((p) => {
      const e = enrich.get(p.memberId);
      return {
        memberId: p.memberId, memberName: p.memberName,
        email: e?.email ?? null, phone: e?.phone ?? null, institution: e?.institution ?? null,
        declaredCoi: p.coiDeclared, coiNote: p.coiNote,
      };
    });
    return reply.send({ interviewId: id, ...detectConflicts(body.candidate as CandidateProfile, panel) });
  });

  // ---- scan against an ad-hoc panel (screening committee) --------------
  app.post("/v1/hrms/recruitment/coi-scan", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = z.object({ candidate: candidateShape, panelMembers: panelMemberShape }).parse(req.body);
    const panel: PanelMember[] = body.panelMembers.map((m) => ({ memberId: m.memberId, memberName: m.memberName, email: m.email ?? null, phone: m.phone ?? null, institution: m.institution ?? null }));
    return reply.send(detectConflicts(body.candidate as CandidateProfile, panel));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
