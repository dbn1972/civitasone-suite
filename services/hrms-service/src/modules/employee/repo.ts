import { eq, and, sql } from "drizzle-orm";
import { pino } from "pino";
import { db, scopedRead} from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import { hrmsEmployees, type EmployeeRow, type EmployeeInsert } from "./schema.js";

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
 * transaction instead of opening a nested one via scopedRead. Cross-module
 * consumers (e.g. contracts/consumer.ts) that look up an employee from
 * inside their own db.transaction() must use this, not findById -- calling
 * the scopedRead-based version there opens a SECOND transaction competing
 * for a connection from the same pool as the outer one, deadlocking every
 * in-flight command once concurrency reaches pool.max (see
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

export async function listByTenant(tenantId: string, limit = 100, offset = 0, employeeType?: string): Promise<EmployeeRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsEmployees)
    .where(employeeType
      ? and(eq(hrmsEmployees.tenantId, tenantId), eq(hrmsEmployees.employeeType, employeeType))
      : eq(hrmsEmployees.tenantId, tenantId))
    .limit(limit)
    .offset(offset));
}

export async function insertEmployee(tx: Writer, row: EmployeeInsert): Promise<void> {
  await tx.insert(hrmsEmployees).values(row);
}

export async function updateEmployee(tx: Writer, id: string, patch: Partial<EmployeeInsert>): Promise<void> {
  await tx.update(hrmsEmployees).set({ ...patch, updatedAt: new Date() }).where(eq(hrmsEmployees.id, id));
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
