import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { canDecide } from "./domain.js";
import * as appRepo from "../registrations/repo.js";

const OFFICER_ROLES = ["shop_admin", "shop_officer", "super_admin"];

const initiateBody = z.object({
  applicationId: z.string().uuid(),
  scrutinyType: z.enum(["document_check", "field_inspection", "noc"]),
  officerId: z.string().uuid(),
});

// Must mirror ScrutinyFinding in ./domain.js. The consumer reads
// findings.items to decide pass/fail (see validateScrutinyComplete); a schema
// this loose (z.record(z.unknown())) let ANY object through, including one
// with no "items" array at all — which silently defaulted to zero findings
// and marked the scrutiny "completed" with no deficiencies, no matter what
// the caller actually reported (live-confirmed: a payload describing a
// failed fire-safety check, shaped without "items", was recorded as a clean
// pass). Validating the real shape here closes that gap at the boundary.
const scrutinyFindingBody = z.object({
  checkItem: z.string().min(1),
  result: z.enum(["pass", "fail", "na"]),
  remarks: z.string().optional(),
});

const completeBody = z.object({
  findings: z.object({
    items: z.array(scrutinyFindingBody).min(1),
  }).passthrough(),
  deficiencyDetails: z.string().optional(),
});

const decideBody = z.object({
  applicationId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().optional(),
});

const idParam = z.object({ id: z.string().uuid() });
const applicationIdQuery = z.object({ applicationId: z.string().uuid() });

export async function approvalRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/shop/approvals/scrutiny", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const body = initiateBody.parse(req.body);
    const application = await appRepo.findById(body.applicationId, ctx.tenantId);
    if (!application) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    if (application.status !== "submitted" && application.status !== "under_scrutiny") {
      throw new HttpError(422, "INVALID_STATUS", `Cannot scrutinize application in status '${application.status}'`);
    }
    return reply.code(202).send(
      await commands.initiateScrutiny(ctx, body.applicationId, body.scrutinyType, body.officerId),
    );
  });

  app.get("/v1/shop/approvals/scrutiny", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const q = applicationIdQuery.parse(req.query);
    const records = await repo.listByApplication(q.applicationId, ctx.tenantId);
    return reply.send({
      data: records,
      meta: { page: 1, pageSize: records.length, total: records.length },
    });
  });

  app.post("/v1/shop/approvals/scrutiny/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = completeBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "SCRUTINY_NOT_FOUND", "Scrutiny record not found");
    if (existing.status !== "pending") {
      throw new HttpError(422, "ALREADY_COMPLETED", "Scrutiny already completed");
    }
    return reply.code(202).send(
      await commands.completeScrutiny(ctx, id, body.findings, body.deficiencyDetails),
    );
  });

  app.post("/v1/shop/approvals/decide", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const body = decideBody.parse(req.body);
    const application = await appRepo.findById(body.applicationId, ctx.tenantId);
    if (!application) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    if (!canDecide(application.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot decide application in status '${application.status}'`);
    }
    return reply.code(202).send(
      await commands.decideApplication(ctx, body.applicationId, body.decision, body.reason),
    );
  });
}
