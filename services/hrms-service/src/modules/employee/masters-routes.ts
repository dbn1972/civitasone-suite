/**
 * Department + Designation master CRUD — needed for first-time tenant setup
 * so employees can be properly classified.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and, count, inArray, notInArray } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { publishF3Write } from "../../shared/f3-publish.js";
import { hrmsDepartments, hrmsDesignations, hrmsEmployees } from "./schema.js";
import { EXITED_STATUSES } from "./status.js";

const HR_READ_ROLES = [
  "hr_admin",
  "hr_officer",
  "super_admin",
  "admin",
  "manager",
  // Finance/payroll roles need department names to submit PFMS salary bills
  // and payment advices (see apps/web finance/pfms/SalaryBillForm.tsx).
  "finance_officer",
  "finance_admin",
  "payroll_admin",
];
const HR_ROLES = ["hr_admin", "super_admin", "admin"];

const createDeptBody = z.object({
  code: z.string().min(1, "Department code is required").max(20),
  name: z.string().min(2, "Department name is required").max(200),
  parentId: z.string().uuid().optional(),
  type: z.string().min(1).max(40).optional(),
  level: z.number().int().min(0).optional(),
  govtTier: z.enum(["central", "state", "local_body", "statutory_body", "autonomous_body"]).optional(),
  locationId: z.string().uuid().optional(),
  headEmployeeId: z.string().uuid().optional(),
});

// GAP-HR-DESIGNATIONS-01: the 7th CPC pay matrix only defines levels 1-18
// (mirrors apps/web/src/lib/payLevels.ts's MIN_PAY_LEVEL/MAX_PAY_LEVEL — kept
// as a literal 1/18 here rather than a cross-service import since web and
// hrms-service are separate deployables with no shared validation package
// today). Previously nonnegative-only, so e.g. level 40 saved and then
// rendered as an unclassifiable "—" on every screen that reads it back.
const createDesignationBody = z.object({
  code: z.string().min(1, "Designation code is required").max(20),
  name: z.string().min(2, "Designation name is required").max(200),
  level: z.number().int().min(1, "Pay level must be between 1 and 18.").max(18, "Pay level must be between 1 and 18.").optional(),
  payGrade: z.string().max(30).optional(),
});

/**
 * GAP-HR-DEPARTMENTS-01: the department list never said how many employees
 * are in each department (every badge always rendered "0"), which also made
 * the -02 delete guard below impossible to reason about client-side. Counts
 * exclude EXITED_STATUSES (terminated/separated/retired) — an employee who
 * has already left is not a reason to block deleting or re-parenting a
 * department.
 */
async function countActiveEmployeesByDept(tenantId: string, deptIds: string[]): Promise<Map<string, number>> {
  if (deptIds.length === 0) return new Map();
  // Plain row select + in-process tally rather than a SQL GROUP BY -- the
  // tenant-scoped employee count per department is a small, bounded number
  // of rows (a tenant's whole workforce, at most), and this keeps the query
  // shape identical to every other `scopedRead` call in this file.
  const rows = await scopedRead((tx) => tx
    .select({ departmentId: hrmsEmployees.departmentId })
    .from(hrmsEmployees)
    .where(and(
      eq(hrmsEmployees.tenantId, tenantId),
      inArray(hrmsEmployees.departmentId, deptIds),
      notInArray(hrmsEmployees.status, [...EXITED_STATUSES]),
    )));
  const counts = new Map<string, number>();
  for (const r of rows) {
    counts.set(r.departmentId, (counts.get(r.departmentId) ?? 0) + 1);
  }
  return counts;
}

/**
 * GAP-HR-DEPARTMENTS-03: walk the parent chain starting at `startId` and
 * return true if `targetId` is found anywhere in it (i.e. targetId is an
 * ancestor of startId, so making startId's parent be targetId — or vice
 * versa — would create a cycle). Defensive `seen` guard in case pre-existing
 * data already has a cycle; stop rather than loop forever.
 */
async function isAncestor(tenantId: string, targetId: string, startId: string): Promise<boolean> {
  let cursor: string | null = startId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === targetId) return true;
    if (seen.has(cursor)) return false;
    seen.add(cursor);
    const row = await scopedRead((tx) => tx.select({ parentId: hrmsDepartments.parentId })
      .from(hrmsDepartments)
      .where(and(eq(hrmsDepartments.id, cursor as string), eq(hrmsDepartments.tenantId, tenantId)))
      .limit(1));
    cursor = row[0]?.parentId ?? null;
  }
  return false;
}

export async function mastersRoutes(app: FastifyInstance): Promise<void> {
  // ── Departments ──
  app.get("/v1/hrms/departments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_READ_ROLES);
    const rows = await scopedRead((tx) => tx.select().from(hrmsDepartments).where(eq(hrmsDepartments.tenantId, ctx.tenantId)));
    const counts = await countActiveEmployeesByDept(ctx.tenantId, rows.map((r) => r.id));
    return reply.send({ data: rows.map((r) => ({ ...r, employeeCount: counts.get(r.id) ?? 0 })) });
  });

  app.post("/v1/hrms/departments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = createDeptBody.parse(req.body);
    // Hierarchy enforcement: level is always derived server-side from the
    // chosen parent (GAP-HR-DEPARTMENTS-03) rather than trusted from the
    // client — trusting a client-supplied level is what let e.g. level 40
    // save silently before with no relation to the actual parent chain.
    let effectiveLevel = body.level;
    if (body.parentId) {
      const parent = await scopedRead((tx) => tx.select().from(hrmsDepartments)
        .where(and(eq(hrmsDepartments.id, body.parentId as string), eq(hrmsDepartments.tenantId, ctx.tenantId))).limit(1));
      if (!parent[0]) {
        return reply.code(400).send({ code: "PARENT_NOT_FOUND", message: "Selected parent department does not exist." });
      }
      effectiveLevel = (parent[0].level ?? 0) + 1;
    } else if (body.level === undefined) {
      effectiveLevel = 0;
    }
    const id = randomUUID();
    await publishF3Write(ctx, "employee_masters_routes__0", id, {
      body: { ...(req.body as Record<string, unknown>), level: effectiveLevel } as Record<string, unknown>,
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
    });
    return reply.code(202).send({ id, status: "created" }) as any;
  });
  app.patch("/v1/hrms/departments/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = req.params as { id: string };
    const body = createDeptBody.partial().parse(req.body);

    // Synchronous pre-check (existence): the old conditional UPDATE WHERE id
    // 404'd when no row matched. Mirror that here — note (unchanged from the
    // original) this lookup is NOT tenant-scoped, matching the pre-existing
    // behaviour of the code being converted; not something this F3 fix set
    // out to change.
    const existing = await scopedRead((tx) => tx.select({ id: hrmsDepartments.id }).from(hrmsDepartments).where(eq(hrmsDepartments.id, id)).limit(1));
    if (!existing[0]) return reply.code(404).send({ code: "NOT_FOUND", message: "Department not found" });

    const publishBody: Record<string, unknown> = { ...(req.body as Record<string, unknown>) };

    // GAP-HR-DEPARTMENTS-03: re-parenting was previously accepted with no
    // cycle guard and no level recompute at all (PATCH never had POST's
    // hierarchy check). A department must never become its own ancestor,
    // and level is re-derived from the new parent the same way POST does.
    if (body.parentId !== undefined && body.parentId !== null) {
      if (body.parentId === id) {
        return reply.code(400).send({ code: "HIERARCHY_CYCLE", message: "A department cannot be its own parent." });
      }
      if (await isAncestor(ctx.tenantId, id, body.parentId)) {
        return reply.code(400).send({ code: "HIERARCHY_CYCLE", message: "A department cannot be moved under one of its own sub-departments." });
      }
      const parent = await scopedRead((tx) => tx.select().from(hrmsDepartments)
        .where(and(eq(hrmsDepartments.id, body.parentId as string), eq(hrmsDepartments.tenantId, ctx.tenantId))).limit(1));
      if (!parent[0]) {
        return reply.code(400).send({ code: "PARENT_NOT_FOUND", message: "Selected parent department does not exist." });
      }
      publishBody.level = (parent[0].level ?? 0) + 1;
    }

    await publishF3Write(ctx, "employee_masters_routes__2", id, { body: publishBody, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(202).send({ id, status: "updated" }) as any;
  });

  app.delete("/v1/hrms/departments/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = req.params as { id: string };

    // Synchronous pre-check (existence) — same reasoning as PATCH above.
    const existing = await scopedRead((tx) => tx.select({ id: hrmsDepartments.id }).from(hrmsDepartments).where(eq(hrmsDepartments.id, id)).limit(1));
    if (!existing[0]) return reply.code(404).send({ code: "NOT_FOUND", message: "Department not found" });

    // GAP-HR-DEPARTMENTS-02: previously deleted unconditionally, leaving
    // employees pointing at a deleted department id and orphaned children
    // silently re-rooted by the tree UI on the client. Recommended default
    // from the HR gap decision packet's "everything else" theme
    // (redesign/gaps/hr.md decision packet, Sep 2026): block outright rather
    // than silently orphan; whether to instead offer a soft-delete
    // (hrmsDepartments.isActive already exists) is a separate, deeper
    // product decision left open — see this PR's description.
    const childCountRows = await scopedRead((tx) => tx
      .select({ childCount: count() })
      .from(hrmsDepartments)
      .where(and(eq(hrmsDepartments.tenantId, ctx.tenantId), eq(hrmsDepartments.parentId, id))));
    // A bare COUNT(*) aggregate always returns exactly one row in practice,
    // but the array type alone doesn't guarantee that to the compiler --
    // default to 0 rather than assume/destructure.
    const childCount = Number(childCountRows[0]?.childCount ?? 0);
    const employeeCounts = await countActiveEmployeesByDept(ctx.tenantId, [id]);
    const employeeCount = employeeCounts.get(id) ?? 0;
    if (childCount > 0 || employeeCount > 0) {
      return reply.code(409).send({
        code: "DEPARTMENT_IN_USE",
        message: "This department still has sub-departments or employees assigned to it. Reassign or remove them first.",
        childCount,
        employeeCount,
      });
    }

    await publishF3Write(ctx, "employee_masters_routes__3", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(202).send();
  });


  // ── Designations ──
  app.get("/v1/hrms/designations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_READ_ROLES);
    const rows = await scopedRead((tx) => tx.select().from(hrmsDesignations).where(eq(hrmsDesignations.tenantId, ctx.tenantId)));
    return reply.send({ data: rows });
  });

  app.post("/v1/hrms/designations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = createDesignationBody.parse(req.body);
    const id = randomUUID();
    await publishF3Write(ctx, "employee_masters_routes__1", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(202).send({ id, status: "created" }) as any;
  });
  app.patch("/v1/hrms/designations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = req.params as { id: string };
    createDesignationBody.partial().parse(req.body);

    // Synchronous pre-check (existence) — same reasoning as departments PATCH
    // above (also not tenant-scoped in the original code being converted).
    const existing = await scopedRead((tx) => tx.select({ id: hrmsDesignations.id }).from(hrmsDesignations).where(eq(hrmsDesignations.id, id)).limit(1));
    if (!existing[0]) return reply.code(404).send({ code: "NOT_FOUND", message: "Designation not found" });

    await publishF3Write(ctx, "employee_masters_routes__4", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(202).send({ id, status: "updated" }) as any;
  });

  app.delete("/v1/hrms/designations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = req.params as { id: string };

    // Synchronous pre-check (existence) — same reasoning as above.
    const existing = await scopedRead((tx) => tx.select({ id: hrmsDesignations.id }).from(hrmsDesignations).where(eq(hrmsDesignations.id, id)).limit(1));
    if (!existing[0]) return reply.code(404).send({ code: "NOT_FOUND", message: "Designation not found" });

    await publishF3Write(ctx, "employee_masters_routes__5", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(202).send();
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
