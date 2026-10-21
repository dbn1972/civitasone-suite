import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and, inArray } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { db, scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { randomUUID } from "node:crypto";
import { isKnownEngagementType, resolveKnownEngagementTypeSets } from "../employee/engagement-policy.js";
import { hrmsEmployees } from "../employee/schema.js";
import { emitAudit } from "../recruitment/audit-emit.js";
import * as importRepo from "./repo.js";
import { IMPORT_FAILURE } from "./failure.js";

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
    // GAP-HR-EMPLOYEES-IMPORT-05: per the published decision packet's
    // recommendation ("managerEmployeeNo... keep PAN/Aadhaar/bank out of
    // CSV"). Resolved to managerId server-side below (same tenant, same
    // pattern as the client's own department/designation code resolution)
    // rather than requiring the caller to already know a UUID. payStructure
    // is deliberately NOT added here yet -- unlike department/designation,
    // there is no verified code->id lookup for pay structures in this
    // snapshot (payroll-service's response shape is not confirmable from
    // hrms-service), so guessing at one risked silently mis-assigning pay.
    managerEmployeeNo: z.string().min(1).max(32).optional(),
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

    // GAP-HR-EMPLOYEES-IMPORT-02: this only ever checked for a duplicate
    // employeeNo WITHIN the file being uploaded -- an employeeNo that
    // already belongs to an existing employee in this tenant sailed
    // straight through (no unique index on employee_no either, per the
    // catalog's own finding), silently creating a second row HR would only
    // discover much later (payroll/service-book lookups keyed on
    // employeeNo would then be ambiguous). Checked synchronously, before
    // anything is queued, same as the within-file check below.
    const existingNos = await scopedRead((tx) => tx.select({ employeeNo: hrmsEmployees.employeeNo }).from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), inArray(hrmsEmployees.employeeNo, body.employees.map((e) => e.employeeNo)))));
    const existingNoSet = new Set(existingNos.map((r) => r.employeeNo));

    // GAP-HR-EMPLOYEES-IMPORT-05: resolve managerEmployeeNo -> managerId
    // within this same tenant/file, same "code the caller can actually
    // read" pattern as the client's department/designation resolution.
    // Also detects a self-reference (a row naming its own employeeNo as
    // its manager) up front -- wouldCreateCycle (manager-domain.ts) guards
    // the single-row/edit paths but isn't wired into this bulk path, so
    // this stays a narrower, explicit check rather than silently skipping
    // cycle detection here.
    const managerNos = body.employees.map((e) => e.managerEmployeeNo).filter((v): v is string => !!v);
    const managerRows = managerNos.length > 0
      ? await scopedRead((tx) => tx.select({ id: hrmsEmployees.id, employeeNo: hrmsEmployees.employeeNo }).from(hrmsEmployees)
          .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), inArray(hrmsEmployees.employeeNo, managerNos))))
      : [];
    const managerIdByNo = new Map(managerRows.map((r) => [r.employeeNo, r.id]));
    const fileNos = new Set(body.employees.map((e) => e.employeeNo));

    body.employees.forEach((emp, idx) => {
      if (seen.has(emp.employeeNo)) {
        fieldErrors.push({ field: `employees.${idx}.employeeNo`, message: `Duplicate: ${emp.employeeNo}` });
      }
      seen.add(emp.employeeNo);
      if (existingNoSet.has(emp.employeeNo)) {
        fieldErrors.push({ field: `employees.${idx}.employeeNo`, message: `Already exists in this tenant: ${emp.employeeNo}` });
      }
      // The single-row path enforces this via assertKnownEngagementType
      // (employee/routes.ts's POST /v1/hrms/employees) -- the bulk path
      // queued straight past it with no check at all until this fix, so a
      // typo'd employeeType would reach the DB unvalidated (the consumer
      // just casts `p.employeeType as "permanent"`, which enforces nothing
      // at runtime, it only satisfies the compiler).
      if (!isKnownEngagementType(emp.employeeType, canonical, tenant)) {
        fieldErrors.push({ field: `employees.${idx}.employeeType`, message: `unknown employee type '${emp.employeeType}'` });
      }
      if (emp.managerEmployeeNo) {
        if (emp.managerEmployeeNo === emp.employeeNo) {
          fieldErrors.push({ field: `employees.${idx}.managerEmployeeNo`, message: `An employee cannot be their own manager: ${emp.managerEmployeeNo}` });
        } else if (!managerIdByNo.has(emp.managerEmployeeNo) && !fileNos.has(emp.managerEmployeeNo)) {
          fieldErrors.push({ field: `employees.${idx}.managerEmployeeNo`, message: `Unknown manager employee number: ${emp.managerEmployeeNo}` });
        } else if (!managerIdByNo.has(emp.managerEmployeeNo)) {
          // Named row is elsewhere in the SAME file, not yet an existing
          // employee -- this endpoint queues rows independently (no
          // ordering/dependency guarantee between them), so a same-file
          // manager reference cannot be resolved to a real id here.
          fieldErrors.push({ field: `employees.${idx}.managerEmployeeNo`, message: `${emp.managerEmployeeNo} is in this same file, not an existing employee -- import managers first, then re-import with this column.` });
        }
      }
    });

    if (fieldErrors.length > 0) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "Bulk import has errors", fieldErrors, correlationId: ctx.correlationId });
    }

    // GAP-HR-EMPLOYEES-IMPORT-02: record the batch -- one pending row per employee -- BEFORE
    // anything is queued. The batchId in the 202 is then a real, pollable record, and the create
    // consumer has a row to mark 'created' (atomically with the employee insert) or 'failed'.
    // The row id doubles as the create command's messageId and as the new employee's id.
    const items = body.employees.map((emp, idx) => ({ emp, id: randomUUID(), rowNo: idx + 1 }));
    await db.transaction(async (tx) => {
      await importRepo.insertBatch(tx, {
        id: batchId, tenantId: ctx.tenantId, requestedBy: ctx.actorId, correlationId: ctx.correlationId ?? null,
        rows: items.map((i) => ({ messageId: i.id, rowNo: i.rowNo, employeeNo: i.emp.employeeNo })),
      });
      await emitAudit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId },
        "hrms.employee.bulk_import_requested", "employee_import_batch", batchId, { total: items.length });
    });

    // Queue each employee creation
    let queued = 0;
    try {
      for (const { emp, id } of items) {
        const { managerEmployeeNo, ...rest } = emp;
        await queue.publish("hrms.employee.create", {
          messageId: id, type: "hrms.employee.create",
          tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
          payload: {
            id, tenantId: ctx.tenantId, ...rest, currency: "INR", importBatchId: batchId,
            ...(managerEmployeeNo ? { managerId: managerIdByNo.get(managerEmployeeNo) } : {}),
          },
        });
        queued++;
      }
    } catch (err) {
      // The queue broke part-way. Rows never handed to it will never be processed: mark them failed
      // (best effort) so the batch can finish instead of reading "processing" forever, then surface
      // the error. The row whose publish threw is included -- if it was in fact delivered, the
      // consumer's markRowCreated still wins (created overrides failed).
      await db.transaction(async (tx) => {
        for (const { id } of items.slice(queued)) await importRepo.markRowFailed(tx, ctx.tenantId, id, IMPORT_FAILURE.NOT_QUEUED);
      }).catch((markErr) => req.log.error({ markErr }, "could not mark un-queued import rows"));
      throw err;
    }

    return sendAccepted(reply, acceptedResponseSchema, { id: batchId, status: "accepted" as const, correlationId: ctx.correlationId });
  });

  // GAP-HR-EMPLOYEES-IMPORT-02: real per-row state. ImportForm polls this every couple of seconds,
  // hence the explicit (generous) per-route limit. 404 for an id that is not a batch of THIS tenant.
  app.get("/v1/hrms/employees/bulk/status/:batchId", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { batchId } = z.object({ batchId: z.string().uuid() }).parse(req.params);
    const status = await importRepo.getBatchStatus(ctx.tenantId, batchId);
    if (!status) throw new HttpError(404, "NOT_FOUND", "import batch not found");
    return reply.send(status);
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
