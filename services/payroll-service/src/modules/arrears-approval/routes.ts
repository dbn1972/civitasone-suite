/**
 *  POST /v1/payroll/arrears/:id/approve   maker-checker: decider != creator (403 SELF_APPROVAL_FORBIDDEN)
 *  POST /v1/payroll/arrears/:id/reject    needs a note
 *  GET  /v1/payroll/arrears/approval-policy
 *  PUT  /v1/payroll/arrears/approval-policy   payroll_admin / super_admin, audited with a reason
 *
 * Routes only read + publish; the consumer owns the (conditional, audited) write.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { approveArrearBody, arrearPolicyBody, rejectArrearBody } from "./api.js";
import * as commands from "./commands.js";

const DECIDER_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];
const POLICY_ROLES = ["payroll_admin", "super_admin"];
const READ_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin"];

async function approvalRequired(tenantId: string): Promise<boolean> {
  const rows = (await scopedRead((tx) => tx.execute(sql`
    SELECT arrears_approval_required AS required FROM payroll.payroll_settings WHERE tenant_id = ${tenantId}::uuid LIMIT 1
  `))) as unknown as Array<{ required: boolean }>;
  return rows[0]?.required ?? true;
}

export async function arrearApprovalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/arrears/approval-policy", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    return reply.send({ required: await approvalRequired(ctx.tenantId), actorId: ctx.actorId });
  });

  app.put("/v1/payroll/arrears/approval-policy", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, POLICY_ROLES);
    const body = arrearPolicyBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.setArrearPolicy(ctx, body));
  });

  for (const decision of ["approve", "reject"] as const) {
    app.post(`/v1/payroll/arrears/:id/${decision}`, async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, DECIDER_ROLES);
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const body = (decision === "reject" ? rejectArrearBody : approveArrearBody).parse(req.body ?? {});
      const rows = (await scopedRead((tx) => tx.execute(sql`
        SELECT status, created_by::text AS created_by, run_id FROM payroll.payroll_arrears
         WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid LIMIT 1
      `))) as unknown as Array<{ status: string; created_by: string; run_id: string | null }>;
      const row = rows[0];
      if (!row) throw new HttpError(404, "NOT_FOUND", "arrear not found");
      if (row.status !== "pending" || row.run_id) {
        throw new HttpError(409, "ARREAR_NOT_PENDING", `arrear is already ${row.run_id ? "paid in a run" : row.status}`);
      }
      if (row.created_by === ctx.actorId && (await approvalRequired(ctx.tenantId))) {
        throw new HttpError(403, "SELF_APPROVAL_FORBIDDEN", "an arrear must be decided by someone other than its creator");
      }
      return sendAccepted(reply, acceptedResponseSchema, await commands.decideArrear(ctx, {
        id, decision: decision === "approve" ? "approved" : "rejected", note: body.note,
      }));
    });
  }
}
