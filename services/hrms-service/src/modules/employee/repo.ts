import { eq, and, or, ilike, sql, inArray, desc } from "drizzle-orm";
import { pino } from "pino";
import { db, scopedRead} from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import {
  hrmsEmployees, hrmsDepartments, hrmsDesignations, hrmsProbationExtensions,
  type EmployeeRow, type EmployeeInsert, type ProbationExtensionInsert,
} from "./schema.js";

const log = pino({ name: "employee-repo" });

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findById(id: string, tenantId: string): Promise<EmployeeRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, tenantId)))
    .limit(1));
  return rows[0] ?? null;
}

/**
 * Tx-scoped variant of findById: reads through the caller's already-open
 * transaction instead of opening a nested one via scopedRead. Used by
 * employeeSeparate (own module) and cross-module by contracts/consumer.ts
 * -- calling the scopedRead-based version from inside an open
 * db.transaction() opens a SECOND transaction competing for a connection
 * from the same pool as the outer one, deadlocking every in-flight command
 * once concurrency reaches pool.max (see
 * .claude/skills/16-production-readiness-audit.md section 1).
 */
export async function findByIdTx(tx: Writer, id: string, tenantId: string): Promise<EmployeeRow | null> {
  const rows = await (tx as typeof db).select().from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findByNo(employeeNo: string, tenantId: string): Promise<EmployeeRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.employeeNo, employeeNo), eq(hrmsEmployees.tenantId, tenantId)))
    .limit(1));
  return rows[0] ?? null;
}

/**
 * `managerId` optionally restricts to direct reports of that employee id —
 * SEC: manager-role read-scoping (employee/routes.ts's resolveManagerScope).
 * hrmsEmployees.managerId is the same reporting-line FK orgchart's
 * tree-building and leave/routes.ts's manager exemption already use for
 * "who reports to whom" (see that migration's own "managerId already
 * exists, we use it as reporting officer" comment in
 * migrations/0007_geo_attendance_ro.sql).
 */
export async function listByTenant(tenantId: string, limit = 100, offset = 0, employeeType?: string, managerId?: string, q?: string): Promise<EmployeeRow[]> {
  const conditions = [eq(hrmsEmployees.tenantId, tenantId)];
  if (employeeType) conditions.push(eq(hrmsEmployees.employeeType, employeeType));
  if (managerId) conditions.push(eq(hrmsEmployees.managerId, managerId));
  // GAP-HR-SF-06 (EntityPicker): optional free-text search over name/employee
  // number for the picker's search(q) adapter -- same tenant/manager scoping
  // as every other filter on this query, just one more optional condition.
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(or(ilike(hrmsEmployees.fullName, pattern), ilike(hrmsEmployees.employeeNo, pattern))!);
  }
  return scopedRead((tx) => tx.select().from(hrmsEmployees)
    .where(and(...conditions))
    .limit(limit)
    .offset(offset));
}

/**
 * Batch id lookup, tenant + optional manager-scope filtered, full row shape
 * (matching listByTenant) -- backs GET /v1/hrms/employees?ids=... , the
 * picker's resolve(ids) adapter (GAP-HR-SF-06), which pre-populates an edit
 * form's label for an id it already has (e.g. GAP-HR-EMPLOYEES-DETAIL-
 * EDIT-04's blank pay-structure/manager select). Deliberately reuses the
 * exact same row shape as listByTenant (queries.ts's listEmployees maps
 * both through identical mapping code) rather than a bespoke projection, so
 * the same "only these columns ever leave this route" guarantee covers
 * both paths.
 */
export async function listByIds(tenantId: string, ids: string[], managerId?: string): Promise<EmployeeRow[]> {
  if (ids.length === 0) return [];
  const conditions = [eq(hrmsEmployees.tenantId, tenantId), inArray(hrmsEmployees.id, ids)];
  if (managerId) conditions.push(eq(hrmsEmployees.managerId, managerId));
  return scopedRead((tx) => tx.select().from(hrmsEmployees).where(and(...conditions)));
}

/**
 * Effective-dating scheduler fix: the full tenant universe for
 * lifecycle/effective-scheduler.ts's per-tenant discovery loop. Every
 * tenant that could possibly have a due promotion/transfer necessarily has
 * at least one row here (hrms_promotions/hrms_transfers both FK to
 * hrms_employees), so this is a safe, complete set to loop over — it may
 * include a few extra tenants with employees but no lifecycle activity,
 * which just costs one cheap, empty, tenant-scoped due-lookup each.
 *
 * MUST be called through shared/db.ts's scopedPlatformRead (never
 * scopedRead / a bare query) — this table's FORCE ROW LEVEL SECURITY has
 * no bypass for an unscoped cross-tenant SELECT otherwise; see that
 * function's doc comment for the full story.
 */
export async function listEmployeeTenantIds(tx: Writer): Promise<string[]> {
  const rows = await (tx as typeof db)
    .select({ tenantId: hrmsEmployees.tenantId })
    .from(hrmsEmployees)
    .groupBy(hrmsEmployees.tenantId);
  return rows.map((r) => r.tenantId);
}

export async function insertEmployee(tx: Writer, row: EmployeeInsert): Promise<void> {
  await tx.insert(hrmsEmployees).values(row);
}

// GAP-HR-CONFIRMATION-05
export async function insertProbationExtension(tx: Writer, row: ProbationExtensionInsert): Promise<void> {
  await tx.insert(hrmsProbationExtensions).values(row);
}

/**
 * An employee's current probation end: the newEndDate of their most
 * recently recorded extension, if any, else the default of dateOfJoining +
 * 2 years. NOTE: this default formula is duplicated (not imported) in
 * lifecycle/m7-list-routes.ts's confirmations list handler, which needs the
 * same computation for every row in a batch rather than one employee at a
 * time -- module boundaries (CLAUDE.md rule 4) make a single shared helper
 * awkward without a larger refactor of that file's existing local batch*
 * pattern, which is unrelated to this fix and out of scope. Keep both in
 * sync if the default ever changes.
 */
export async function findCurrentProbationEnd(id: string, tenantId: string): Promise<string | null> {
  const emp = await findById(id, tenantId);
  if (!emp?.dateOfJoining) return null;
  const latest = await scopedRead((tx) => tx
    .select({ newEndDate: hrmsProbationExtensions.newEndDate })
    .from(hrmsProbationExtensions)
    .where(and(eq(hrmsProbationExtensions.tenantId, tenantId), eq(hrmsProbationExtensions.employeeId, id)))
    .orderBy(desc(hrmsProbationExtensions.createdAt))
    .limit(1));
  if (latest[0]) return latest[0].newEndDate;
  const join = new Date(`${emp.dateOfJoining}T00:00:00Z`);
  join.setUTCFullYear(join.getUTCFullYear() + 2);
  return join.toISOString().slice(0, 10);
}

/**
 * Recruitment hardening: existence checks the hire consumer runs before
 * insertEmployee so an unknown departmentId/designationId fails fast with a
 * clear error instead of a raw FK-violation crash. Tx-scoped (called from
 * inside the hire consumer's already-open transaction) -- see findByIdTx's
 * doc comment above for why a scopedRead-based variant can't be used there.
 */
export async function departmentExistsTx(tx: Writer, id: string, tenantId: string): Promise<boolean> {
  const rows = await (tx as typeof db).select({ id: hrmsDepartments.id }).from(hrmsDepartments)
    .where(and(eq(hrmsDepartments.id, id), eq(hrmsDepartments.tenantId, tenantId)))
    .limit(1);
  return rows.length > 0;
}

export async function designationExistsTx(tx: Writer, id: string, tenantId: string): Promise<boolean> {
  const rows = await (tx as typeof db).select({ id: hrmsDesignations.id }).from(hrmsDesignations)
    .where(and(eq(hrmsDesignations.id, id), eq(hrmsDesignations.tenantId, tenantId)))
    .limit(1);
  return rows.length > 0;
}

export async function updateEmployee(tx: Writer, id: string, patch: Partial<EmployeeInsert>): Promise<void> {
  await tx.update(hrmsEmployees).set({ ...patch, updatedAt: new Date() }).where(eq(hrmsEmployees.id, id));
}

/**
 * Status-guarded employee write (SEC: hrms status-integrity fix — e.g.
 * employeeConfirm). Mirrors updateEmployeeVersioned's WHERE-precondition
 * pattern below, but keyed on `status` instead of `version`: the UPDATE's
 * WHERE clause re-checks status = expectedStatus atomically WITH the write,
 * so a concurrent status-changing writer (e.g. a separate/terminate command
 * landing in the window between the caller's own precondition read and this
 * write) can never be silently clobbered. hrms_employees has no automatic
 * version bump on every write — only basicMinor writes opt into that via
 * updateEmployeeVersioned below — so for a status transition, a plain
 * read-then-blind-write is not actually race-safe on its own; this closes
 * that gap by enforcing the precondition as part of the single UPDATE
 * statement rather than as a separate round-trip.
 *
 * Returns false (does not throw) when the WHERE clause matched zero rows —
 * either the row doesn't exist, or (assuming the caller already confirmed
 * existence via a fresh read earlier in the same transaction) status no
 * longer equals expectedStatus. Callers should treat false as a conflict.
 */
export async function updateEmployeeIfStatus(
  tx: Writer,
  id: string,
  tenantId: string,
  expectedStatus: string,
  patch: Partial<EmployeeInsert>,
): Promise<boolean> {
  const res = await tx.update(hrmsEmployees)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(
      eq(hrmsEmployees.id, id),
      eq(hrmsEmployees.tenantId, tenantId),
      eq(hrmsEmployees.status, expectedStatus),
    ));
  const rowCount = (res as { rowCount?: number; count?: number }).rowCount
    ?? (res as { count?: number }).count ?? 0;
  return rowCount > 0;
}

/**
 * Read {basicMinor, version} fresh, inside the caller's own transaction,
 * immediately before deciding what to write. Used by every consumer that
 * may write hrms_employees.basicMinor (annual increment, promotion — direct
 * and eOffice-approved — and the generic employee-update command) so each
 * can pass the version it just read back to updateEmployeeVersioned below.
 */
export async function findVersionForUpdate(
  tx: Writer, id: string, tenantId: string,
): Promise<{ version: number; basicMinor: bigint } | null> {
  const rows = await tx.select({ version: hrmsEmployees.version, basicMinor: hrmsEmployees.basicMinor })
    .from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Optimistic-concurrency-guarded employee write. `basicMinor` is written by
 * several independent, asynchronous consumers — the pay-matrix annual
 * increment, the direct and eOffice-approved promotion paths, and the
 * generic employee-update command — that can legitimately race each other
 * (e.g. a promotion and an increment landing close together for the same
 * employee). The plain `updateEmployee` above is a blind overwrite: if two
 * of those consumers race, whichever writes last silently clobbers the
 * other's pay change with no error and no audit trail.
 *
 * Callers must first read the row's current version via
 * `findVersionForUpdate` (in the SAME transaction as this call) and pass it
 * back as `expectedVersion`. The UPDATE's WHERE re-checks that version at
 * write time and bumps it atomically with the patch, mirroring the
 * `version: sql\`... + 1\`` + WHERE-version pattern used throughout this
 * codebase (see e.g. cpf/repo.ts's bumpAccountVersion, or the
 * WHERE-version guards already used elsewhere in this table by
 * employee/f3-consumer.ts).
 *
 * If the row changed since it was read (0 rows affected), this NEVER
 * silently succeeds: it logs the conflict and throws. The caller's queue
 * subscriber is expected to let that propagate — the queue's own bounded
 * retry (re-invoking the handler, which reads fresh again) self-heals a
 * transient race; a write whose precondition can never again be satisfied
 * (e.g. a pay-matrix increment plan computed against a `fromMinor` that
 * someone else has since changed) will keep failing until it lands in the
 * DLQ for manual review — which is the correct outcome, since nothing here
 * should silently recompute or discard a stale plan on the caller's behalf.
 */
export async function updateEmployeeVersioned(
  tx: Writer,
  id: string,
  tenantId: string,
  expectedVersion: number,
  patch: Partial<EmployeeInsert>,
  updatedBy: string,
): Promise<void> {
  const res = await tx.update(hrmsEmployees)
    .set({ ...patch, updatedBy, version: sql`${hrmsEmployees.version} + 1`, updatedAt: new Date() })
    .where(and(
      eq(hrmsEmployees.id, id),
      eq(hrmsEmployees.tenantId, tenantId),
      eq(hrmsEmployees.version, expectedVersion),
    ));
  const rowCount = (res as { rowCount?: number; count?: number }).rowCount
    ?? (res as { count?: number }).count ?? 0;
  if (rowCount === 0) {
    log.error(
      { employeeId: id, tenantId, expectedVersion, fields: Object.keys(patch) },
      "employee write lost the optimistic-concurrency race — the row was changed by another writer since it was read; refusing to overwrite blindly",
    );
    throw new HttpError(
      409,
      "EMPLOYEE_VERSION_CONFLICT",
      `employee ${id} was modified by another writer since version ${expectedVersion} was read; refusing to apply this write blindly`,
    );
  }
}

/**
 * Batch id -> row/name lookups for cross-module display enrichment
 * (GAP-HR-SF-17). Other modules (e.g. lifecycle/routes.ts) resolve
 * employee/department/designation NAMES for a list of ids through these
 * exports — never by importing ./schema.js and querying hrmsEmployees /
 * hrmsDepartments / hrmsDesignations directly from outside this module,
 * which would violate CLAUDE.md rule 4 (module isolation: a module's repo
 * queries only its own schema; cross-module data goes through an
 * in-process domain interface — this file is that interface for the
 * employee module's lookup tables). See shared/batch-resolve.ts for the
 * generic Map-building wrapper these feed.
 *
 * Column-projected (not a full EmployeeRow select) on purpose: callers only
 * need display fields, and a generic cross-module helper shouldn't pull
 * salary/bank/Aadhaar-adjacent columns just to resolve a name.
 */
export async function findManyByIds(
  tenantId: string,
  ids: string[],
): Promise<Array<{ id: string; fullName: string; employeeNo: string; departmentId: string; designationId: string }>> {
  if (ids.length === 0) return [];
  return scopedRead((tx) => tx
    .select({
      id: hrmsEmployees.id,
      fullName: hrmsEmployees.fullName,
      employeeNo: hrmsEmployees.employeeNo,
      departmentId: hrmsEmployees.departmentId,
      designationId: hrmsEmployees.designationId,
    })
    .from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.tenantId, tenantId), inArray(hrmsEmployees.id, ids))));
}

export async function findDepartmentsByIds(
  tenantId: string,
  ids: string[],
): Promise<Array<{ id: string; name: string }>> {
  if (ids.length === 0) return [];
  return scopedRead((tx) => tx
    .select({ id: hrmsDepartments.id, name: hrmsDepartments.name })
    .from(hrmsDepartments)
    .where(and(eq(hrmsDepartments.tenantId, tenantId), inArray(hrmsDepartments.id, ids))));
}

export async function findDesignationsByIds(
  tenantId: string,
  ids: string[],
): Promise<Array<{ id: string; name: string }>> {
  if (ids.length === 0) return [];
  return scopedRead((tx) => tx
    .select({ id: hrmsDesignations.id, name: hrmsDesignations.name })
    .from(hrmsDesignations)
    .where(and(eq(hrmsDesignations.tenantId, tenantId), inArray(hrmsDesignations.id, ids))));
}
