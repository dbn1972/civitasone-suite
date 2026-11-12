import type { FastifyInstance } from "fastify";
import { uanBlindIndexEnabled } from "../../shared/s8-flags.js";
import { existingUans } from "../employee/uan-lookup.js";
import { z, ZodError } from "zod";
import { eq, and, inArray } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { randomUUID } from "node:crypto";
import { zTrimmedText, zTrimmedCode, zIsoDate, DATE_WINDOWS, istToday } from "@civitasone/schemas/validators";
import { isKnownEngagementType, resolveKnownEngagementTypeSets } from "../employee/engagement-policy.js";
import { hrmsEmployees } from "../employee/schema.js";
import { isExitedStatus } from "../employee/status.js";
import * as importRepo from "./repo.js";
import { RECORD_CHUNK_SIZE, type BulkImportItem, type BulkImportRecordItem } from "./command.js";
import { bulkSensitiveImportEnabled } from "../../shared/s8-flags.js";
import { aadhaarColumnErrors, sealCreatePayload, sensitiveFieldsPresent, sensitiveRowErrors, sensitiveRowShape } from "./sensitive.js";

const HR_ROLES = ["hr_admin", "super_admin", "admin"];

const bulkImportRow = z.object({
    // UAT b23: same trim / non-blank / date-window rules as POST /v1/hrms/employees (bundle 21 fixed
    // only the single-row create path; the bulk path stored "  " names, padded numbers, year 2999).
    employeeNo: zTrimmedCode(32, "employee number"),
    fullName: zTrimmedText(256, { label: "full name" }),
    departmentId: z.string().uuid(),
    designationId: z.string().uuid(),
    dateOfJoining: zIsoDate({ window: () => DATE_WINDOWS.dateOfJoining(istToday()), label: "date of joining" }),
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
    managerEmployeeNo: zTrimmedCode(32, "manager employee number").optional(),
});
const bulkImportBody = z.object({ employees: z.array(bulkImportRow).min(1).max(500) });
// G6 (Section 8, flag HRMS_S8_BULK_IMPORT_ENABLED): the same row plus the optional sensitive columns.
const bulkImportBodySensitive = z.object({ employees: z.array(bulkImportRow.extend(sensitiveRowShape)).min(1).max(500) });

export async function bulkImportRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/employees/bulk", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const sensitiveOn = bulkSensitiveImportEnabled();
    // Aadhaar stays out (owner decision 5): refuse the column outright, naming it, before any other validation.
    if (sensitiveOn) {
      const aadhaar = aadhaarColumnErrors((req.body as { employees?: unknown } | undefined)?.employees);
      if (aadhaar.length > 0) {
        return reply.code(400).send({ code: "VALIDATION_FAILED", message: "Bulk import has errors", fieldErrors: aadhaar, correlationId: ctx.correlationId });
      }
    }
    const body = (sensitiveOn ? bulkImportBodySensitive : bulkImportBody).parse(req.body) as z.infer<typeof bulkImportBodySensitive>;
    // ?dryRun=true (flag on): run every check below and answer, with no side effect (nothing queued, no batch recorded).
    // Honoured only with the flag on: flag off, the parameter is ignored exactly as before this change.
    const dryRun = sensitiveOn && (req.query as { dryRun?: string } | undefined)?.dryRun === "true";
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
    //
    // An exited (terminated / separated / retired) employee cannot be a
    // reporting manager -- the same rule PATCH /v1/hrms/employees/:id
    // enforces (employee/manager-eligibility.ts, GAP-HR-EMPLOYEES-DETAIL-EDIT-05),
    // since an exited manager breaks approval routing. `status` is read here so
    // a row naming one gets a row-level error instead of being queued.
    const managerNos = body.employees.map((e) => e.managerEmployeeNo).filter((v): v is string => !!v);
    const managerRows = managerNos.length > 0
      ? await scopedRead((tx) => tx.select({ id: hrmsEmployees.id, employeeNo: hrmsEmployees.employeeNo, status: hrmsEmployees.status }).from(hrmsEmployees)
          .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), inArray(hrmsEmployees.employeeNo, managerNos))))
      : [];
    const managerIdByNo = new Map(managerRows.map((r) => [r.employeeNo, r.id]));
    const exitedManagerNos = new Set(managerRows.filter((r) => isExitedStatus(r.status)).map((r) => r.employeeNo));
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
        } else if (exitedManagerNos.has(emp.managerEmployeeNo)) {
          // Exists in this tenant but has left the organisation: not an eligible manager (see the note above).
          fieldErrors.push({ field: `employees.${idx}.managerEmployeeNo`, message: `${emp.managerEmployeeNo} has left the organisation (terminated, separated or retired) and cannot be a reporting manager.` });
        }
      }
    });

    // G6: pairing, in-file and in-tenant duplicate checks for PAN / UAN / bank account. Values are compared in memory
    // and only ever reported masked (sensitive.ts).
    if (sensitiveOn && body.employees.some((e) => e.pan || e.uanNumber || e.bankAccountNo || e.bankIfsc)) {
      // UAN blind index (flag HRMS_UAN_BLIND_INDEX_ENABLED, tenant fully backfilled): the UAN comparison is a keyed-HMAC
      // lookup and the UAN column is not decrypted at all. Otherwise exactly the previous behaviour.
      const indexed = uanBlindIndexEnabled()
        ? await existingUans(ctx.tenantId, body.employees.map((e) => e.uanNumber).filter((u): u is string => !!u))
        : null;
      const held = await scopedRead((tx) => indexed
        ? tx.select({ pan: hrmsEmployees.pan, bankAccountNo: hrmsEmployees.bankAccountNo }).from(hrmsEmployees).where(eq(hrmsEmployees.tenantId, ctx.tenantId)).then((r) => r.map((x) => ({ ...x, uanNumber: null as string | null })))
        : tx.select({ pan: hrmsEmployees.pan, uanNumber: hrmsEmployees.uanNumber, bankAccountNo: hrmsEmployees.bankAccountNo })
            .from(hrmsEmployees).where(eq(hrmsEmployees.tenantId, ctx.tenantId)));
      const collect = (k: "pan" | "uanNumber" | "bankAccountNo") => new Set(held.map((h) => h[k]).filter((v): v is string => !!v));
      fieldErrors.push(...sensitiveRowErrors(body.employees, { pan: collect("pan"), uanNumber: indexed ?? collect("uanNumber"), bankAccountNo: collect("bankAccountNo") }));
    }

    if (fieldErrors.length > 0) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "Bulk import has errors", fieldErrors, ...(dryRun ? { dryRun: true } : {}), correlationId: ctx.correlationId });
    }
    if (dryRun) {
      return reply.code(200).send({ dryRun: true, ok: true, rowCount: body.employees.length, correlationId: ctx.correlationId });
    }

    // GAP-HR-EMPLOYEES-IMPORT-02: this route only publishes (CQRS -- see f3-leftover-hrms-cqrs.test.ts). The record
    // command's consumer commits the batch and one pending row per employee, and only THEN publishes the per-employee
    // create commands, so the batchId in the 202 becomes a real, pollable record and each create has a row to mark
    // 'created' (atomically with the employee insert) or 'failed'. The row id doubles as the create command's messageId
    // and as the new employee's id. Until the consumer has run, GET .../status answers 404 for the new id.
    const items: BulkImportRecordItem[] = body.employees.map((emp, idx) => {
      const { managerEmployeeNo, ...rest } = emp;
      const id = randomUUID();
      const create = {
        id, tenantId: ctx.tenantId, ...rest, currency: "INR", importBatchId: batchId,
        ...(managerEmployeeNo ? { managerId: managerIdByNo.get(managerEmployeeNo) } : {}),
      };
      return {
        id, rowNo: idx + 1, employeeNo: emp.employeeNo,
        // Sealed with the HRMS PII envelope so the queue never holds a clear PAN / account / UAN (no-op for a row without them).
        create: sensitiveOn ? sealCreatePayload(create) : create,
      };
    });
    const sensitiveFields = sensitiveOn ? sensitiveFieldsPresent(body.employees) : [];
    const total = items.length;
    const chunks: BulkImportRecordItem[][] = [];
    for (let i = 0; i < total; i += RECORD_CHUNK_SIZE) chunks.push(items.slice(i, i + RECORD_CHUNK_SIZE));
    const envelope = <T>(type: string, payload: T) => ({
      messageId: randomUUID(), type,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload,
    });

    let published = 0;
    try {
      for (const chunk of chunks) {
        await queue.publish(COMMANDS.employeeBulkImportRecord, envelope(COMMANDS.employeeBulkImportRecord, { batchId, total, items: chunk, ...(sensitiveFields.length > 0 ? { sensitiveFields } : {}) }));
        published++;
      }
    } catch (err) {
      // The queue broke part-way. The chunks never published would leave their rows unrecorded -- the batch reading
      // "processing" forever -- so tell the consumer to record them as failed. Best effort (the queue is what just
      // broke); the chunk whose publish threw is included, as it may in fact have been delivered. Then surface the error.
      const unsent: BulkImportItem[] = chunks.slice(published).flat().map(({ id, rowNo, employeeNo }) => ({ id, rowNo, employeeNo }));
      await queue.publish(COMMANDS.employeeBulkImportNotQueued, envelope(COMMANDS.employeeBulkImportNotQueued, { batchId, total, items: unsent }))
        .catch((markErr) => req.log.error({ markErr }, "could not record un-queued import rows"));
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
