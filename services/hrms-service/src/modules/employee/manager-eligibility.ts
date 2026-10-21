/**
 * GAP-HR-EMPLOYEES-DETAIL-EDIT-05: server-side rule for who may be set as an
 * employee's reporting manager through the generic PATCH /v1/hrms/employees/:id.
 *
 * The edit form's picker already hides exited staff and the employee
 * themself, but that is a client nicety -- any API caller could still send
 * `managerId` = self, an unknown id, an exited (terminated / separated /
 * retired) colleague, or someone who already reports (directly or
 * indirectly) to this employee, any of which breaks approval routing. The
 * dedicated PATCH .../managers route has a cycle check of its own; this is the
 * same protection for the generic route, shared by the route (synchronous
 * pre-check, immediate 4xx) and the consumer (race-safety re-check inside the
 * write transaction).
 *
 * `lookup` abstracts the read so the route can use the tenant-scoped repo
 * helper and the consumer its already-open transaction.
 */
import { HttpError } from "../../shared/context.js";
import { isExitedStatus } from "./status.js";

export type ManagerLookup = (employeeId: string) => Promise<{ status: string; managerId: string | null } | null>;

/** Upper bound on how far up the reporting chain the cycle walk goes (mirrors manager-domain.ts). */
const MAX_CHAIN_DEPTH = 50;

/**
 * Employee ids are uuids. `z.string().uuid()` accepts upper-case hex and
 * Postgres matches the uuid type case-insensitively, so the same employee can
 * arrive spelled two ways. Every id comparison in this rule goes through these
 * helpers so a differently-cased id can never slip past the self / cycle checks.
 */
export function normalizeEmployeeId(id: string): string {
  return id.toLowerCase();
}

/** Case-insensitive id equality; a null / undefined side is never equal. */
export function isSameEmployeeId(a: string | null | undefined, b: string | null | undefined): boolean {
  return a != null && b != null && normalizeEmployeeId(a) === normalizeEmployeeId(b);
}

export async function assertEligibleManager(lookup: ManagerLookup, employeeId: string, managerId: string): Promise<void> {
  const employee = normalizeEmployeeId(employeeId);
  const proposed = normalizeEmployeeId(managerId);
  if (proposed === employee) {
    throw new HttpError(422, "CYCLE_DETECTED", "an employee cannot be their own manager");
  }
  const manager = await lookup(proposed);
  if (!manager) {
    throw new HttpError(422, "INVALID_MANAGER", "the proposed manager does not exist in this organisation");
  }
  if (isExitedStatus(manager.status)) {
    throw new HttpError(422, "INVALID_MANAGER", `the proposed manager has status '${manager.status}' and has left the organisation`);
  }
  // Walk UP from the proposed manager; reaching `employee` means the proposed
  // manager already reports (transitively) to this employee, so assigning
  // them would close a loop. Every managerId read back from `lookup` is
  // normalised too, so a row that returns a differently-cased id is still caught.
  let current: string | null = manager.managerId === null ? null : normalizeEmployeeId(manager.managerId);
  const seen = new Set<string>([proposed]);
  for (let depth = 0; current !== null && depth < MAX_CHAIN_DEPTH; depth++) {
    if (current === employee) {
      throw new HttpError(422, "CYCLE_DETECTED", "assigning this manager would create a circular reporting chain");
    }
    if (seen.has(current)) break; // pre-existing loop elsewhere in the data: not this assignment's doing
    seen.add(current);
    const next: { status: string; managerId: string | null } | null = await lookup(current);
    current = next && next.managerId !== null ? normalizeEmployeeId(next.managerId) : null;
  }
}
