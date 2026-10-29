import { and, eq, ne, sql } from "drizzle-orm";
import type { db } from "../../shared/db.js";
import { hrmsEmployees } from "./schema.js";
import { EXITED_STATUSES } from "./status.js";

/**
 * FQ14: the single "one employee record per login" rule, shared by every
 * path that writes hrms_employees.user_ref -- HR's explicit link
 * (login-link.ts) and the verified-email auto-link (actor-link.ts) -- so the
 * two can never disagree or race each other into a duplicate link.
 *
 * Statuses that may NOT receive a new login link (HR link or auto-link): the
 * permanently exited ones plus no_show (never joined). Kept identical to the
 * statuses the partial unique index in
 * migrations/0253_hrms_employees_user_ref_unique.sql leaves out.
 */
export const LINK_INELIGIBLE_STATUSES: readonly string[] = [...EXITED_STATUSES, "no_show"];

export function isLinkIneligibleStatus(status: string): boolean {
  return LINK_INELIGIBLE_STATUSES.includes(status);
}

type Tx = Pick<typeof db, "select" | "execute">;

/**
 * Serialise every user_ref write for one (tenant, login) pair. Transaction-
 * scoped (released at COMMIT/ROLLBACK). Callers take the employee row lock
 * (SELECT ... FOR UPDATE) FIRST and this lock second, so all writers acquire
 * locks in the same order and cannot deadlock each other.
 */
export async function lockLogin(tx: Tx, tenantId: string, userId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`hrms.login-link:${tenantId}:${userId}`}, 0))`);
}

/**
 * The id of any employee in this tenant (other than `exceptEmployeeId`)
 * already linked to `userId`, whatever its status, or undefined. Deliberately
 * stricter than "serving holders only": resolveEmployeeForActor counts EVERY
 * row with this user_ref, so letting a second row take a login while an exited
 * row still holds it would lock the login out of self-service
 * (AMBIGUOUS_EMPLOYEE_LINK). HR unlinks the old record first (allowed for any
 * status, audited). Must be called AFTER lockLogin in the same transaction:
 * under READ COMMITTED the statement then sees any link a concurrent writer
 * committed while this one waited on the lock.
 */
export async function findOtherHolder(tx: Tx, tenantId: string, userId: string, exceptEmployeeId?: string): Promise<string | undefined> {
  const rows = await tx.select({ id: hrmsEmployees.id })
    .from(hrmsEmployees)
    .where(and(
      eq(hrmsEmployees.tenantId, tenantId),
      eq(hrmsEmployees.userRef, userId),
      ...(exceptEmployeeId ? [ne(hrmsEmployees.id, exceptEmployeeId)] : []),
    ))
    .limit(1);
  return rows[0]?.id;
}
