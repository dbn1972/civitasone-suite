/**
 * W1 SF-05a -- audited PII reveal for the employee master (DPDP).
 *
 *   POST /v1/hrms/pii/reveal  { resourceType: "employee", resourceId, field, reason } -> { data: { value } }
 *
 * Same request/response contract as crm-service `POST /v1/crm/pii/reveal`, so the
 * web `MaskedReveal` control drives either with only a path change. Every read
 * path of the employee master returns pan / bankAccountNo / phone MASKED
 * (queries.ts maskValue); this is the only way to see a clear value. (bankIfsc
 * is returned in full, so it is not revealable -- owner decision 3.)
 *
 * Guarantees, in order:
 *  1. Role gate (fail closed 403): PAN, Aadhaar and bank account are
 *     hr_admin / super_admin only; the phone number also admits hr_officer.
 *  2. The field must be on a server-side allow-list (never a client column name).
 *  3. The employee must exist in the caller's tenant (RLS-scoped read), else 404.
 *  4. A reason (at least 10 chars) is mandatory.
 *  5. AUDIT FIRST, fail closed: the audit command is durably published (own
 *     messageId) BEFORE the value is returned; if it cannot be queued nothing is
 *     revealed. The consumer below does markProcessed + the audit outbox row in
 *     ONE transaction, so redelivery never double-audits. The audit payload
 *     carries actor / subject / field / reason only, never the value.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { publishF3Write } from "../../shared/f3-publish.js";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { emitAudit } from "../recruitment/audit-emit.js";
import * as repo from "./repo.js";

export const EMPLOYEE_PII_REVEAL_OP = "employee_pii_reveal__0";

type EmployeeColumn = "pan" | "aadhaarRef" | "mobile" | "bankAccountNo";

/** API field name -> employee row column + roles allowed to reveal it. */
export const REVEALABLE_EMPLOYEE_FIELDS: Record<string, { column: EmployeeColumn; roles: string[] }> = {
  pan: { column: "pan", roles: ["hr_admin", "super_admin"] },
  aadhaarRef: { column: "aadhaarRef", roles: ["hr_admin", "super_admin"] },
  bankAccountNo: { column: "bankAccountNo", roles: ["hr_admin", "super_admin"] },
  // bankIfsc is intentionally absent (owner decision 3, 2026-10-14): the IFSC is a
  // public branch code returned in full, so there is nothing to reveal (422).
  phone: { column: "mobile", roles: ["hr_admin", "hr_officer", "super_admin"] },
};

const revealBody = z.object({
  resourceType: z.literal("employee"),
  resourceId: z.string().uuid(),
  field: z.string().min(1).max(64),
  reason: z.string().trim().min(10, "state why you need the clear value (at least 10 characters)").max(2000),
});

export async function employeePiiRevealRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/pii/reveal", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = revealBody.parse(req.body ?? {});
    const spec = Object.hasOwn(REVEALABLE_EMPLOYEE_FIELDS, body.field) ? REVEALABLE_EMPLOYEE_FIELDS[body.field] : undefined;
    if (!spec) throw new HttpError(422, "FIELD_NOT_REVEALABLE", `field '${body.field}' is not revealable for employee`);
    requireRole(ctx, spec.roles);

    const emp = await repo.findById(body.resourceId, ctx.tenantId);
    if (!emp) throw new HttpError(404, "NOT_FOUND", "employee not found");

    // Audit first, fail closed: no queued audit command, no reveal.
    await publishF3Write(ctx, EMPLOYEE_PII_REVEAL_OP, randomUUID(), {
      params: { id: body.resourceId }, query: {},
      body: { action: "employee_pii_revealed", field: body.field, reason: body.reason },
    });

    const value = (emp[spec.column] as string | null | undefined) ?? null;
    void reply.header("cache-control", "no-store");
    return reply.send({ data: { resourceType: "employee", resourceId: body.resourceId, field: body.field, value } });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}

const log = pino({ name: "hrms-employee-pii-reveal" });

export function registerEmployeePiiRevealConsumer(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    if (String(p.op ?? "") !== EMPLOYEE_PII_REVEAL_OP) return;
    const body = (p.body ?? {}) as Record<string, any>;
    const params = (p.params ?? {}) as Record<string, any>;
    const auditCtx = { tenantId: String(p.tenantId), actorId: msg.actorId, correlationId: msg.correlationId };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        // NEVER put the revealed value in the payload.
        await emitAudit(tx, auditCtx, "employee_pii_revealed", "employee", String(params.id), {
          field: body.field, reason: body.reason, subject: String(params.id),
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId, tenantId: auditCtx.tenantId, actorId: msg.actorId, employeeId: params.id, alert: "pii_reveal_audit_failed" },
        "employee PII reveal audit write failed: the reveal was served but is NOT yet on the audit trail; investigate / replay");
      throw err;
    }
  });
}
