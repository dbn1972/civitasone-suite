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

export async function assertEligibleManager(lookup: ManagerLookup, employeeId: string, managerId: string): Promise<void> {
  if (managerId === employeeId) {
    throw new HttpError(422, "CYCLE_DETECTED", "an employee cannot be their own manager");
  }
  const manager = await lookup(managerId);
  if (!manager) {
    throw new HttpError(422, "INVALID_MANAGER", "the proposed manager does not exist in this organisation");
  }
  if (isExitedStatus(manager.status)) {
    throw new HttpError(422, "INVALID_MANAGER", `the proposed manager has status '${manager.status}' and has left the organisation`);
  }
  // Walk UP from the proposed manager; reaching `employeeId` means the proposed
  // manager already reports (transitively) to this employee, so assigning
  // them would close a loop.
  let current: string | null = manager.managerId;
  const seen = new Set<string>([managerId]);
  for (let depth = 0; current !== null && depth < MAX_CHAIN_DEPTH; depth++) {
    if (current === employeeId) {
      throw new HttpError(422, "CYCLE_DETECTED", "assigning this manager would create a circular reporting chain");
    }
    if (seen.has(current)) break; // pre-existing loop elsewhere in the data: not this assignment's doing
    seen.add(current);
    const next: { status: string; managerId: string | null } | null = await lookup(current);
    current = next ? next.managerId : null;
  }
}
