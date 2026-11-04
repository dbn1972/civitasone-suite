/**
 * PR #2459 review B1: opening YTD (pre-go-live / previous employer) per
 * employee and FY -- the authoritative s.192 input.
 *   GET   /v1/payroll/opening-ytd?employeeId=&fy=
 *   POST  /v1/payroll/opening-ytd               (maker; 202)
 *   PATCH /v1/payroll/opening-ytd/:id/approve   (checker != maker; 202)
 *   PATCH /v1/payroll/opening-ytd/:id/reject    (checker != maker; 202)
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import * as commands from "./commands.js";
import { createOpeningYtdBody, decideOpeningYtdBody, listOpeningYtdQuery, idParam } from "./validators.js";

const READ_ROLES = ["payroll_admin", "payroll_officer", "hr_admin", "super_admin"];
const MAKER_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];
const CHECKER_ROLES = ["payroll_admin", "super_admin"];

export async function openingYtdRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/opening-ytd", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listOpeningYtdQuery.parse(req.query ?? {});
    const rows = await commands.listOpeningYtd(ctx.tenantId, q);
    return reply.send({ data: rows.map((r) => ({
      id: r.id, employeeId: r.employeeId, fy: r.fy, source: r.source, months: r.months,
      salaryMinor: r.salaryMinor.toString(), tdsMinor: r.tdsMinor.toString(),
      priorEmployerName: r.priorEmployerName, priorEmployerTan: r.priorEmployerTan, note: r.note,
      status: r.status, enteredBy: r.enteredBy, approvedBy: r.approvedBy, decidedAt: r.decidedAt?.toISOString() ?? null, decisionNote: r.decisionNote,
    })) });
  });

  app.post("/v1/payroll/opening-ytd", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, MAKER_ROLES);
    const body = createOpeningYtdBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.createOpeningYtd(ctx, body));
  });

  for (const [action, decision] of [["approve", "approved"], ["reject", "rejected"]] as const) {
    app.patch(`/v1/payroll/opening-ytd/:id/${action}`, async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, CHECKER_ROLES);
      const { id } = idParam.parse(req.params);
      const body = decideOpeningYtdBody.parse(req.body ?? {});
      return sendAccepted(reply, acceptedResponseSchema, await commands.decideOpeningYtd(ctx, id, decision, body.reason));
    });
  }
}
