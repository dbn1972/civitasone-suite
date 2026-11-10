/**
 * S8 statutory seams -- admin routes (statutory-seams.ts explains the seams).
 *
 *   GET /v1/payroll/statutory/s8-seams                          the tenant flags (both default OFF)
 *   PUT /v1/payroll/statutory/s8-seams                          switch LWF deduction / ESI contribution-period on or off
 *   GET /v1/payroll/statutory/pf-wage-basis/:employeeId         the employee's effective-dated EPF wage basis
 *   PUT /v1/payroll/statutory/pf-wage-basis/:employeeId         set "ceiling" | "actual" from a date (consent reference required)
 *
 * Writes are command routes (zod + read-only guards, publish, 202); the write
 * and its audit event are in statutory-seams-consumer.ts. payroll_admin /
 * super_admin only. A basis effective on or before the latest finalised run
 * month is refused: finalised slips never change.
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
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  consentRef: z.string().trim().min(3).max(200),
});

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
    await queue.publish(COMMANDS.s8SeamFlagsSet, {
      messageId: id, type: COMMANDS.s8SeamFlagsSet,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { tenantId: ctx.tenantId, ...body },
    });
    return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted", correlationId: ctx.correlationId });
  });

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
    const latest = await scopedRead((tx) => latestFinalisedRunMonth(tx as never, ctx.tenantId));
    if (latest && body.effectiveFrom.slice(0, 7) <= latest) {
      throw new HttpError(409, "PF_BASIS_BACKDATED", `a PF wage basis cannot take effect in or before ${latest}: that run is already finalised`);
    }
    const id = randomUUID();
    await queue.publish(COMMANDS.s8PfBasisSet, {
      messageId: id, type: COMMANDS.s8PfBasisSet,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { tenantId: ctx.tenantId, employeeId, ...body },
    });
    return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted", correlationId: ctx.correlationId });
  });
}
void sql;
