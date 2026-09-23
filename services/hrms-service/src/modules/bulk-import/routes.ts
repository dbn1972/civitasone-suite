import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { queue } from "../../shared/infra.js";
import { randomUUID } from "node:crypto";
import { isKnownEngagementType, resolveKnownEngagementTypeSets } from "../employee/engagement-policy.js";

const HR_ROLES = ["hr_admin", "super_admin", "admin"];

const bulkImportBody = z.object({
  employees: z.array(z.object({
    employeeNo: z.string().min(1).max(32),
    fullName: z.string().min(1).max(256),
    departmentId: z.string().uuid(),
    designationId: z.string().uuid(),
    dateOfJoining: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    email: z.string().email().optional(),
    mobile: z.string().max(20).optional(),
    gender: z.enum(["male", "female", "other"]).optional(),
    basicMinor: z.number().int().nonnegative().default(0),
    // FINDING-2 (HRMS role-based review): missing entirely until this fix --
    // ImportForm.tsx (and createEmployeeBody, the single-row equivalent)
    // both send/require employeeType, and employee/consumer.ts's queue
    // handler reads p.employeeType straight off this same
    // hrms.employee.create payload (via `...emp` below) and inserts it
    // uncoerced -- so every bulk-imported employee was silently getting
    // employeeType: undefined. Default matches createEmployeeBody's.
    employeeType: z.string().min(1).max(32).default("permanent"),
  })).min(1).max(500),
});

export async function bulkImportRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/employees/bulk", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = bulkImportBody.parse(req.body);
    const batchId = randomUUID();

    // Validate all rows before queueing. Both checks report through
    // `fieldErrors` (field: "employees.<idx>.<field>"), the same envelope
    // shape the ZodError handler below already produces for a schema
    // failure. FINDING-2 (HRMS role-based review): this used to be a
    // bespoke `errors: [{row, field, message}]` shape that no frontend
    // consumer could parse -- this route had no frontend consumer at all.
    // apps/web's shared useFormError hook only recognises `fieldErrors`
    // (keyed by field), the way locations/list/LocationActions.tsx already
    // relies on -- one shared shape means ImportForm.tsx can read either
    // failure mode (a hand-built validation error here, or a Zod parse
    // failure) the same way.
    const fieldErrors: Array<{ field: string; message: string }> = [];
    const seen = new Set<string>();
    const { canonical, tenant } = await resolveKnownEngagementTypeSets(ctx.tenantId);
    body.employees.forEach((emp, idx) => {
      if (seen.has(emp.employeeNo)) {
        fieldErrors.push({ field: `employees.${idx}.employeeNo`, message: `Duplicate: ${emp.employeeNo}` });
      }
      seen.add(emp.employeeNo);
      // The single-row path enforces this via assertKnownEngagementType
      // (employee/routes.ts's POST /v1/hrms/employees) -- the bulk path
      // queued straight past it with no check at all until this fix, so a
      // typo'd employeeType would reach the DB unvalidated (the consumer
      // just casts `p.employeeType as "permanent"`, which enforces nothing
      // at runtime, it only satisfies the compiler).
      if (!isKnownEngagementType(emp.employeeType, canonical, tenant)) {
        fieldErrors.push({ field: `employees.${idx}.employeeType`, message: `unknown employee type '${emp.employeeType}'` });
      }
    });

    if (fieldErrors.length > 0) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "Bulk import has errors", fieldErrors, correlationId: ctx.correlationId });
    }

    // Queue each employee creation
    for (const emp of body.employees) {
      const id = randomUUID();
      await queue.publish("hrms.employee.create", {
        messageId: id, type: "hrms.employee.create",
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
        payload: { id, tenantId: ctx.tenantId, ...emp, currency: "INR" },
      });
    }

    return sendAccepted(reply, acceptedResponseSchema, { id: batchId, status: "accepted" as const, correlationId: ctx.correlationId });
  });

  app.get("/v1/hrms/employees/bulk/status/:batchId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    // NOT WIRED TO REAL STATE (pre-existing -- left as-is by the HRMS
    // role-based review's finding-2 fix, which is scoped to making
    // ImportForm.tsx call the bulk endpoint correctly, not to building batch
    // tracking). This always answers "completed" regardless of what the
    // queued hrms.employee.create messages actually did -- there is no
    // import_batches table or equivalent behind it, and batchId isn't even
    // persisted anywhere by the POST handler above, so this route cannot
    // presently distinguish a real batch id from a made-up one. Do not wire
    // ImportForm.tsx (or any client) to poll this expecting per-row
    // success/failure -- it would report "completed" even when every queued
    // row failed downstream. Needs a real import_batches table (or
    // equivalent) written by employee/consumer.ts per processed row before
    // this can honestly answer per-row status.
    return reply.send({ batchId: (req.params as any).batchId, status: "completed", message: "Batch processed via CQRS" });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
