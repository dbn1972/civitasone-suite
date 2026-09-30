import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Onboarding tasks CRUD (T19) + buddy assignment (T20) + document checklist
 * (COMP-015).
 *
 *   POST /v1/hrms/employees/:id/onboarding-tasks   add a task
 *   GET  /v1/hrms/employees/:id/onboarding-tasks   list tasks
 *   PATCH /v1/hrms/onboarding-tasks/:taskId/complete  mark complete
 *   POST /v1/hrms/employees/:id/buddy              assign buddy/mentor
 *   GET  /v1/hrms/employees/:id/buddy              list buddy assignments
 *   GET  /v1/hrms/employees/:id/onboarding-documents                  real per-employee document checklist
 *   PATCH /v1/hrms/employees/:id/onboarding-documents/:docType/mark-received  HR marks a document received
 *   PATCH /v1/hrms/employees/:id/onboarding-documents/:docType/verify         HR verifies (or rejects) a document
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and, inArray } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { hrmsOnboardingTasks, hrmsBuddyAssignments, hrmsMandatoryDocConfigs, hrmsOnboardingDocuments } from "./schema.js";
import { hrmsEmployees, hrmsDepartments } from "../employee/schema.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });
const taskParam = z.object({ taskId: z.string().uuid() });
const idDocTypeParam = z.object({ id: z.string().uuid(), docType: z.string().min(1).max(64) });

// ── Document checklist (COMP-015) ───────────────────────────────────────────
//
// Platform-default catalogue, used whenever a tenant has configured no
// hrms_mandatory_doc_configs rows for an employee's employeeType -- which is
// every tenant today, since nothing seeds that table at migration time (see
// 0140_onboarding_documents.sql's header comment for why a cross-tenant
// migration-time backfill was tried and deliberately reverted: hrms-service
// migrations run as the non-BYPASSRLS `hrms_svc` role, so a plain migration
// cannot see other tenants' rows to seed against). This constant IS the seed
// default the gap report asked for -- applied at read time instead of at
// migration time -- and it replaces DEFAULT_DOCUMENTS as a fallback CATALOGUE
// (which doc types apply), never as fabricated per-employee STATUS: every
// entry below carries no status of its own, and mergeOnboardingDocuments()
// always sources status from this employee's own hrms_onboarding_documents
// rows (defaulting an employee with zero rows to "pending", which is true,
// not invented -- a new joinee genuinely has submitted nothing yet). A tenant
// that configures its own hrms_mandatory_doc_configs rows (via the existing
// POST /v1/hrms/mandatory-doc-configs) overrides this default going forward.
export const DEFAULT_DOC_CATALOGUE: ReadonlyArray<{ docType: string; required: boolean }> = [
  { docType: "appointment_letter", required: true },
  { docType: "government_id", required: true },
  { docType: "address_proof", required: true },
  { docType: "education_certificate", required: true },
  { docType: "pan_card", required: true },
  { docType: "bank_details", required: true },
];

export interface MergedOnboardingDocument {
  docType: string;
  required: boolean;
  status: string;
  receivedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  /** Object-storage key of the uploaded file, if any (GAP-HR-ONBOARDING-DETAIL-02). */
  storageKey: string | null;
  /** Original filename of the uploaded file, if any. */
  fileName: string | null;
}

/**
 * Pure merge: the tenant+employeeType document catalogue (what's required) ×
 * this one employee's own hrms_onboarding_documents rows (what THEY have
 * actually submitted/had verified). A config type with no matching employee
 * row is real, not fabricated: it means this employee has not actioned that
 * document yet, so it renders "pending" -- exactly like a brand-new
 * hrms_onboarding_tasks row starts "pending" until someone completes it.
 * Two employees with different rows in `employeeRows` always produce
 * different output here, which is the whole fix for COMP-015.
 */
export function mergeOnboardingDocuments(
  configRows: ReadonlyArray<{ docType: string; required: boolean }>,
  employeeRows: ReadonlyArray<{
    docType: string;
    status: string;
    receivedAt: Date | string | null;
    verifiedBy: string | null;
    verifiedAt: Date | string | null;
    storageKey?: string | null;
    fileName?: string | null;
  }>,
): MergedOnboardingDocument[] {
  const catalogue = configRows.length > 0 ? configRows : DEFAULT_DOC_CATALOGUE;
  const byType = new Map(employeeRows.map((r) => [r.docType, r]));
  return catalogue.map((c) => {
    const row = byType.get(c.docType);
    return {
      docType: c.docType,
      required: c.required,
      status: row?.status ?? "pending",
      receivedAt: row?.receivedAt ? new Date(row.receivedAt).toISOString() : null,
      verifiedBy: row?.verifiedBy ?? null,
      verifiedAt: row?.verifiedAt ? new Date(row.verifiedAt).toISOString() : null,
      storageKey: row?.storageKey ?? null,
      fileName: row?.fileName ?? null,
    };
  });
}

// ── Tenant-wide onboarding summary (GET /v1/hrms/onboarding) ───────────────
//
// Pure row-shaping + filtering, split out of the route handler so it's
// testable without a database (mirrors mergeOnboardingDocuments() above).

export type OnboardingTaskLite = { employeeId: string; status: string; dueByDay: number };
export type OnboardingEmployeeLite = {
  id: string;
  fullName: string | null;
  employeeNo: string | null;
  departmentId: string | null;
  dateOfJoining: string | null;
};

export interface OnboardingSummaryRow {
  id: string;
  employee: string;
  employeeNo: string;
  /** null (not a raw uuid, not "—") when the department can't be resolved — GAP-HR-ONBOARDING-04. */
  department: string | null;
  /** null (not "—", which downstream date-formatting would render as "Invalid Date") when unknown. */
  joiningDate: string | null;
  stepsCompleted: string;
  totalSteps: string;
  overdue: number;
  progress: string;
  status: "completed" | "overdue" | "in_progress";
}

export type OnboardingStatusFilter = "all" | "active" | "in_progress" | "overdue" | "completed";

export interface OnboardingCounts {
  total: number;
  inProgress: number;
  overdue: number;
  completed: number;
}

/**
 * One row per employee with >=1 task, in insertion order of `empIds`.
 * `todayStr` is injected (rather than computed from `new Date()` inside)
 * so the overdue calculation is deterministic and unit-testable.
 */
export function buildOnboardingSummaryRows(
  empIds: readonly string[],
  empMap: ReadonlyMap<string, OnboardingEmployeeLite>,
  deptMap: ReadonlyMap<string, string>,
  tasksByEmployee: ReadonlyMap<string, readonly OnboardingTaskLite[]>,
  todayStr: string,
): OnboardingSummaryRow[] {
  return empIds.map((empId) => {
    const emp = empMap.get(empId);
    const empTasks = tasksByEmployee.get(empId) ?? [];
    const total = empTasks.length;
    const completed = empTasks.filter((t) => t.status === "completed").length;
    const overdue = empTasks.filter((t) => {
      if (t.status === "completed" || !emp?.dateOfJoining) return false;
      // Both sides are date-only strings or Date objects from a date column;
      // compute due date in UTC to avoid local-tz midnight hazard.
      const join = new Date(emp.dateOfJoining + "T00:00:00Z");
      const due = new Date(join);
      due.setUTCDate(due.getUTCDate() + t.dueByDay);
      return due.toISOString().slice(0, 10) < todayStr;
    }).length;
    const status = completed === total ? "completed" : overdue > 0 ? "overdue" : "in_progress";
    return {
      id: empId,
      employee: emp?.fullName ?? "—",
      employeeNo: emp?.employeeNo ?? "—",
      department: emp?.departmentId ? (deptMap.get(emp.departmentId) ?? null) : null,
      joiningDate: emp?.dateOfJoining ?? null,
      stepsCompleted: `${completed}/${total}`,
      totalSteps: String(total),
      overdue,
      progress: total > 0 ? `${Math.round((completed / total) * 100)}%` : "0%",
      status,
    };
  });
}

/** Tenant-wide counts over every row, independent of any status filter/pagination applied afterwards. */
export function countOnboardingRows(rows: readonly OnboardingSummaryRow[]): OnboardingCounts {
  return {
    total: rows.length,
    inProgress: rows.filter((r) => r.status === "in_progress").length,
    overdue: rows.filter((r) => r.status === "overdue").length,
    completed: rows.filter((r) => r.status === "completed").length,
  };
}

export function filterOnboardingRows(
  rows: readonly OnboardingSummaryRow[],
  status: OnboardingStatusFilter,
): OnboardingSummaryRow[] {
  if (status === "all") return [...rows];
  if (status === "active") return rows.filter((r) => r.status !== "completed");
  return rows.filter((r) => r.status === status);
}

const onboardingListQuery = z.object({
  // GAP-HR-ONBOARDING-05: "active" (everything except completed) is the
  // default so a fresh, unfiltered visit doesn't grow unbounded with every
  // joinee who has ever finished onboarding -- "all" is available as an
  // explicit choice, never implied by omission.
  status: z.enum(["all", "active", "in_progress", "overdue", "completed"]).default("active"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function onboardingRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/employees/:id/onboarding-tasks", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      title: z.string().min(1).max(200),
      dueByDay: z.coerce.number().int().min(1).max(365),
      assignedTo: z.string().uuid().optional(),
    }).parse(req.body);
    const tid = randomUUID();
    await publishF3Write(ctx, "lifecycle_onboarding_routes__0", tid, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: tid, employeeId: id, status: "pending" }) as any;
  });

  app.get("/v1/hrms/employees/:id/onboarding-tasks", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const rows = await scopedRead((tx) => tx.select().from(hrmsOnboardingTasks)
      .where(and(eq(hrmsOnboardingTasks.tenantId, ctx.tenantId), eq(hrmsOnboardingTasks.employeeId, id))));
    return reply.send({ data: rows });
  });

  app.patch("/v1/hrms/onboarding-tasks/:taskId/complete", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { taskId } = taskParam.parse(req.params);
    await publishF3Write(ctx, "lifecycle_onboarding_routes__1", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id: taskId, status: "completed" }) as any;
  });

  app.post("/v1/hrms/employees/:id/buddy", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      buddyId: z.string().uuid(),
      role: z.enum(["buddy", "mentor"]).default("buddy"),
    }).parse(req.body);
    const bid = randomUUID();
    await publishF3Write(ctx, "lifecycle_onboarding_routes__2", bid, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: bid, employeeId: id, role: body.role }) as any;
  });

  app.get("/v1/hrms/employees/:id/buddy", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const rows = await scopedRead((tx) => tx.select().from(hrmsBuddyAssignments)
      .where(and(eq(hrmsBuddyAssignments.tenantId, ctx.tenantId), eq(hrmsBuddyAssignments.employeeId, id))));
    return reply.send({ data: rows });
  });

  // GET /v1/hrms/employees/:id/onboarding-documents — this employee's real
  // document checklist (COMP-015): required doc types for their employeeType
  // (hrms_mandatory_doc_configs, falling back to DEFAULT_DOC_CATALOGUE if the
  // tenant has configured none), merged with their own actual submission/
  // verification status (hrms_onboarding_documents).
  app.get("/v1/hrms/employees/:id/onboarding-documents", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);

    const empRows = await scopedRead((tx) => tx
      .select({ employeeType: hrmsEmployees.employeeType })
      .from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), eq(hrmsEmployees.id, id)))
      .limit(1));
    const employeeType = empRows[0]?.employeeType ?? "permanent";

    const configRows = await scopedRead((tx) => tx
      .select({ docType: hrmsMandatoryDocConfigs.docType, required: hrmsMandatoryDocConfigs.required })
      .from(hrmsMandatoryDocConfigs)
      .where(and(eq(hrmsMandatoryDocConfigs.tenantId, ctx.tenantId), eq(hrmsMandatoryDocConfigs.employeeType, employeeType))));

    const employeeRows = await scopedRead((tx) => tx.select().from(hrmsOnboardingDocuments)
      .where(and(eq(hrmsOnboardingDocuments.tenantId, ctx.tenantId), eq(hrmsOnboardingDocuments.employeeId, id))));

    return reply.send({ data: mergeOnboardingDocuments(configRows, employeeRows) });
  });

  // PATCH /v1/hrms/employees/:id/onboarding-documents/:docType/mark-received
  // — HR (or the employee's self-service upload flow) records that this
  // document has been submitted. Upserts on (tenant, employee, docType): the
  // first action for a given document type creates its row, later ones
  // update it — see lifecycle_onboarding_routes__3 in f3-consumer.ts.
  app.patch("/v1/hrms/employees/:id/onboarding-documents/:docType/mark-received", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id, docType } = idDocTypeParam.parse(req.params);
    // GAP-HR-ONBOARDING-DETAIL-02: validate (not just pass through) an
    // optional storage key + filename, so a malformed body fails fast with
    // VALIDATION_FAILED instead of silently persisting garbage via the F3
    // consumer. Both stay optional: HR can mark a document received as a
    // manual action with no fresh upload attached.
    const body = z.object({
      storageKey: z.string().min(1).max(1024).optional(),
      fileName: z.string().min(1).max(255).optional(),
    }).parse(req.body ?? {});
    await publishF3Write(ctx, "lifecycle_onboarding_routes__3", randomUUID(), { body: body as Record<string, unknown>, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ employeeId: id, docType, status: "uploaded" }) as any;
  });

  // PATCH /v1/hrms/employees/:id/onboarding-documents/:docType/verify — HR
  // verifies (or rejects) a submitted document. Same upsert semantics as
  // mark-received, so verifying a document HR never explicitly received
  // still produces a real row rather than erroring.
  app.patch("/v1/hrms/employees/:id/onboarding-documents/:docType/verify", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id, docType } = idDocTypeParam.parse(req.params);
    const body = z.object({
      status: z.enum(["verified", "rejected"]).default("verified"),
    }).parse(req.body ?? {});
    await publishF3Write(ctx, "lifecycle_onboarding_routes__4", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ employeeId: id, docType, status: body.status }) as any;
  });

  // GET /v1/hrms/onboarding — tenant-wide onboarding summary (one row per
  // employee with tasks), status-filterable and paginated.
  //
  // GAP-HR-ONBOARDING-05: `meta.counts` is computed over every row that
  // matches the tenant (before the status filter/pagination below), so the
  // stat tiles built from it stay correct regardless of which filtered,
  // paginated slice of `filtered` actually renders as cards.
  app.get("/v1/hrms/onboarding", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { status, limit, offset } = onboardingListQuery.parse(req.query);

    const tasks = await scopedRead((tx) => tx.select().from(hrmsOnboardingTasks)
      .where(eq(hrmsOnboardingTasks.tenantId, ctx.tenantId)).limit(2000));

    if (tasks.length === 0) {
      return reply.send({ data: [], meta: { total: 0, limit, offset, counts: countOnboardingRows([]) } });
    }

    const empIds = [...new Set(tasks.map((t) => t.employeeId))];
    const employees = await scopedRead((tx) => tx
      .select({ id: hrmsEmployees.id, fullName: hrmsEmployees.fullName, employeeNo: hrmsEmployees.employeeNo, departmentId: hrmsEmployees.departmentId, dateOfJoining: hrmsEmployees.dateOfJoining })
      .from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), inArray(hrmsEmployees.id, empIds))));

    const empMap = new Map(employees.map((e) => [e.id, e]));
    const deptIds = [...new Set(employees.map((e) => e.departmentId).filter(Boolean))] as string[];
    const depts = deptIds.length > 0 ? await scopedRead((tx) => tx
      .select({ id: hrmsDepartments.id, name: hrmsDepartments.name })
      .from(hrmsDepartments)
      .where(and(eq(hrmsDepartments.tenantId, ctx.tenantId), inArray(hrmsDepartments.id, deptIds)))) : [];
    const deptMap = new Map(depts.map((d) => [d.id, d.name]));
    const grouped = new Map<string, OnboardingTaskLite[]>();
    for (const t of tasks) {
      if (!grouped.has(t.employeeId)) grouped.set(t.employeeId, []);
      grouped.get(t.employeeId)!.push(t);
    }

    const todayStr = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD" in UTC
    const all = buildOnboardingSummaryRows(empIds, empMap, deptMap, grouped, todayStr);
    const counts = countOnboardingRows(all);
    const filtered = filterOnboardingRows(all, status);
    const page = filtered.slice(offset, offset + limit);

    return reply.send({ data: page, meta: { total: filtered.length, limit, offset, counts } });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
