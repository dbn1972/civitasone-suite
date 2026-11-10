/**
 * S8 statutory seams -- admin routes (statutory-seams.ts explains the seams).
 *
 *   GET   /v1/payroll/statutory/s8-seams                              the tenant flags (both default OFF)
 *   PUT   /v1/payroll/statutory/s8-seams                              REQUEST a flag change (pending, 202)
 *   GET   /v1/payroll/statutory/s8-seams/requests[?status=]           change requests (flags and PF basis)
 *   PATCH /v1/payroll/statutory/s8-seams/requests/:id/approve|reject  a DIFFERENT admin decides (maker != checker)
 *   GET   /v1/payroll/statutory/pf-wage-basis/:employeeId             the employee's APPROVED effective-dated EPF wage basis
 *   PUT   /v1/payroll/statutory/pf-wage-basis/:employeeId             REQUEST "ceiling" | "actual" from the 1st of a month (pending, 202)
 *
 * Both writes are maker-checker: the PUT only records a PENDING request; nothing
 * changes a run until a different payroll_admin / super_admin approves it. The
 * write and its audit events are in statutory-seams-consumer.ts. A PF basis
 * effective in or before the latest finalised run month is refused: finalised
 * slips never change. effectiveFrom must be the 1st (a basis applies to whole months).
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { searchEmployeeSummariesStrict } from "../../shared/hrms-client.js";
import { COMMANDS } from "../../topics.js";
import { latestFinalisedRunMonth } from "./pt-versions-repo.js";
import { resolveSeamFlags, pfWageBasisRowsByEmployee } from "./statutory-seams-repo.js";

const ADMIN_ROLES = ["payroll_admin", "super_admin"];
const READER_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"];

export const seamFlagsBody = z.object({
  lwfDeductionEnabled: z.boolean().optional(),
  esiContributionPeriodEnabled: z.boolean().optional(),
  reason: z.string().trim().min(10).max(500),
}).refine((b) => b.lwfDeductionEnabled !== undefined || b.esiContributionPeriodEnabled !== undefined, { message: "at least one flag is required" });

export const pfWageBasisBody = z.object({
  basis: z.enum(["ceiling", "actual"]),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-01$/, "effectiveFrom must be the 1st of a month (a basis applies to whole months)"),
  consentRef: z.string().trim().min(3).max(200),
});

type RequestRow = { id: string; kind: string; employee_id: string | null; payload: unknown; reason: string; status: string; code: string | null; requested_by: string; decided_by: string | null; created_at: string };

function envelope(ctx: { tenantId: string; actorId: string; correlationId: string }, type: string, payload: Record<string, unknown>, id: string) {
  return { messageId: id, type, tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { tenantId: ctx.tenantId, ...payload } };
}

export async function statutorySeamsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/statutory/s8-seams", async (req) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    return scopedRead((tx) => resolveSeamFlags(tx as never, ctx.tenantId));
  });

  app.put("/v1/payroll/statutory/s8-seams", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = seamFlagsBody.parse(req.body);
    const id = randomUUID();
    await queue.publish(COMMANDS.s8SeamFlagsSet, envelope(ctx, COMMANDS.s8SeamFlagsSet, body, id));
    return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.get("/v1/payroll/statutory/s8-seams/requests", async (req) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = z.object({ status: z.enum(["pending", "approved", "rejected"]).optional() }).parse(req.query);
    const rows = await scopedRead(async (tx) => (await tx.execute(sql`
      SELECT id::text AS id, kind, employee_id::text AS employee_id, payload, reason, status, code, requested_by::text AS requested_by,
             decided_by::text AS decided_by, created_at::text AS created_at
        FROM payroll.payroll_s8_change_requests
       WHERE tenant_id = ${ctx.tenantId}::uuid ${q.status ? sql`AND status = ${q.status}` : sql``}
       ORDER BY created_at DESC LIMIT 200`)) as unknown as RequestRow[]);
    return { data: rows };
  });

  const decide = (decision: "approved" | "rejected") => async (req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ note: z.string().trim().max(500).optional() }).parse(req.body ?? {});
    const r = await scopedRead(async (tx) => ((await tx.execute(sql`
      SELECT status, requested_by::text AS requested_by FROM payroll.payroll_s8_change_requests
       WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid`)) as unknown as Array<{ status: string; requested_by: string }>)[0]);
    if (!r) throw new HttpError(404, "NOT_FOUND", "request not found");
    if (r.status !== "pending") throw new HttpError(409, "INVALID_STATE", `request is already ${r.status}`);
    // maker != checker: the consumer's conditional UPDATE (and a CHECK constraint) re-assert this.
    if (r.requested_by === ctx.actorId) throw new HttpError(403, "SELF_APPROVAL_FORBIDDEN", "a change must be decided by someone other than the administrator who requested it");
    const cmd = randomUUID();
    await queue.publish(COMMANDS.s8ChangeDecide, envelope(ctx, COMMANDS.s8ChangeDecide, { id, decision, note: body.note ?? null }, cmd));
    return sendAccepted(reply, acceptedResponseSchema, { id: cmd, status: "accepted", correlationId: ctx.correlationId });
  };
  app.patch("/v1/payroll/statutory/s8-seams/requests/:id/approve", decide("approved"));
  app.patch("/v1/payroll/statutory/s8-seams/requests/:id/reject", decide("rejected"));

  app.get("/v1/payroll/statutory/pf-wage-basis/:employeeId", async (req) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { employeeId } = z.object({ employeeId: z.string().uuid() }).parse(req.params);
    const rows = await scopedRead((tx) => pfWageBasisRowsByEmployee(tx as never, ctx.tenantId, [employeeId]));
    return { employeeId, basis: rows.get(employeeId) ?? [] };
  });

  app.put("/v1/payroll/statutory/pf-wage-basis/:employeeId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { employeeId } = z.object({ employeeId: z.string().uuid() }).parse(req.params);
    const body = pfWageBasisBody.parse(req.body);
    if (Number.isNaN(Date.parse(`${body.effectiveFrom}T00:00:00Z`))) throw new HttpError(422, "EFFECTIVE_FROM_INVALID", "effectiveFrom is not a valid date");
    // The employee must exist in this tenant (HRMS is authoritative; the feed is tenant-scoped; unreachable HRMS -> 503, fail closed).
    const known = await searchEmployeeSummariesStrict(ctx.tenantId, { ids: [employeeId] });
    if (!known.has(employeeId)) throw new HttpError(404, "EMPLOYEE_NOT_FOUND", "no such employee in this tenant");
    const latest = await scopedRead((tx) => latestFinalisedRunMonth(tx as never, ctx.tenantId));
    if (latest && body.effectiveFrom.slice(0, 7) <= latest) {
      throw new HttpError(409, "PF_BASIS_BACKDATED", `a PF wage basis cannot take effect in or before ${latest}: that run is already finalised`);
    }
    const id = randomUUID();
    await queue.publish(COMMANDS.s8PfBasisSet, envelope(ctx, COMMANDS.s8PfBasisSet, { employeeId, ...body }, id));
    return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted", correlationId: ctx.correlationId });
  });
}
