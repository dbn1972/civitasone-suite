/**
 * UAT P3 b19 D-15: the tenant TDS deductor (Form 16 / 24Q / 26Q / 12BA).
 *
 *   GET /v1/payroll/settings/deductor  -> the identity in force, where it comes
 *       from (tenant | env | null) and what is wrong with it, if anything.
 *   PUT /v1/payroll/settings/deductor  { name, tan, pan, reason? } -> 202;
 *       validated here (400), written + audited by the consumer.
 */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { deductorProblems, normaliseDeductor } from "./domain.js";
import { resolveDeductor } from "./repo.js";
import type { DeductorUpdatePayload } from "./consumer.js";

const READ_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"];
const ADMIN_ROLES = ["payroll_admin", "super_admin"];

const updateBody = z.object({
  name: z.string().max(200),
  tan: z.string().max(20),
  pan: z.string().max(20),
  reason: z.string().trim().max(500).optional(),
});

export async function deductorConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/settings/deductor", async (req, reply) => {
    void reply.header("cache-control", "no-store");
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    return resolveDeductor(ctx.tenantId);
  });

  app.put("/v1/payroll/settings/deductor", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_FAILED", parsed.error.issues.map((i) => `${i.path.join(".") || "(body)"}: ${i.message}`).join("; "));
    }
    const next = normaliseDeductor(parsed.data);
    const problems = deductorProblems(next);
    if (problems.length > 0) throw new HttpError(400, "VALIDATION_FAILED", problems.join("; "));
    const id = randomUUID();
    const payload: DeductorUpdatePayload = {
      tenantId: ctx.tenantId, name: next.name!, tan: next.tan!, pan: next.pan!, reason: parsed.data.reason || null,
    };
    await queue.publish(COMMANDS.deductorUpdate, {
      messageId: id, type: COMMANDS.deductorUpdate,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload,
    });
    return sendAccepted(reply, acceptedResponseSchema, { id: ctx.tenantId, status: "accepted", correlationId: ctx.correlationId });
  });
}
