import { and, eq, ne, notInArray, sql } from "drizzle-orm";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue } from "../../shared/outbox.js";
import { HttpError } from "../../shared/context.js";
import { fetchUserStatus } from "../../shared/identity-client.js";
import { hrmsEmployees } from "./schema.js";
import { EXITED_STATUSES, isExitedStatus } from "./status.js";
import type { LoginLinkBody } from "./validators.js";

const AUDIT = "audit.event.record";

export type LoginLinkResult = {
  id: string;
  userRef: string | null;
  previousUserRef: string | null;
  changed: boolean;
};

/**
 * FQ14: HR links (or unlinks) a login to an employee record explicitly.
 *
 * Self-service (leave, attendance, claims, manager approvals) finds "my"
 * employee row via hrms_employees.user_ref = the caller's JWT sub (see
 * actor-link.ts). Until now the only way that column got set was the
 * email-fallback auto-link, which could not work for real logins (identity
 * could not resolve a Keycloak sub), and there was no HR route to set it, so
 * nobody could act as themselves. This is that route.
 *
 * Synchronous, not a queued command: the write is a single-row update whose
 * preconditions (row exists in this tenant, login not already held by another
 * serving employee) must be answered to the caller, and a 202 that the
 * consumer could later refuse is exactly what the employee routes' pre-checks
 * exist to avoid. One tenant-GUC transaction holds the precondition reads, the
 * update and the audit outbox event, so the audit record exists if and only if
 * the change does.
 *
 * Rules:
 *  - one serving (not terminated/separated/retired) employee per login per
 *    tenant: 409 LOGIN_ALREADY_LINKED otherwise. Serialised per (tenant, login)
 *    with a transaction-scoped advisory lock so two concurrent links of the
 *    same login to two employees cannot both pass the check.
 *  - linking an exited employee is refused (409 EMPLOYEE_EXITED); unlinking one
 *    is allowed, so a stale link can always be cleared.
 *  - the login must be a real, ACTIVE user of this tenant per identity-service
 *    (which resolves both identity ids and Keycloak subs). Fails CLOSED: an
 *    unverifiable login is a 503, never a silent link.
 */
export async function setEmployeeLoginLink(
  ctx: RequestContext,
  employeeId: string,
  body: LoginLinkBody,
): Promise<LoginLinkResult> {
  const tenantId = ctx.tenantId;
  const userId = body.userId;

  if (userId !== null) {
    const status = await fetchUserStatus(tenantId, userId);
    if (status === undefined) {
      throw new HttpError(503, "IDENTITY_UNAVAILABLE", "could not verify the login with identity-service; try again");
    }
    if (status === null) {
      throw new HttpError(422, "LOGIN_NOT_FOUND", "no user with this id exists in this tenant");
    }
    if (status !== "active") {
      throw new HttpError(409, "LOGIN_NOT_ACTIVE", `the login has status '${status}' and cannot be linked`);
    }
  }

  const result = await db.transaction(async (tx) => {
    const rows = await tx.select({ id: hrmsEmployees.id, status: hrmsEmployees.status, userRef: hrmsEmployees.userRef })
      .from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.id, employeeId), eq(hrmsEmployees.tenantId, tenantId)))
      .for("update")
      .limit(1);
    const emp = rows[0];
    if (!emp) throw new HttpError(404, "NOT_FOUND", "employee not found");
    const previousUserRef = emp.userRef ?? null;

    if (userId !== null) {
      if (isExitedStatus(emp.status)) {
        throw new HttpError(409, "EMPLOYEE_EXITED", `employee has status '${emp.status}'; a login cannot be linked to an exited employee`);
      }
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`hrms.login-link:${tenantId}:${userId}`}, 0))`);
      const holders = await tx.select({ id: hrmsEmployees.id })
        .from(hrmsEmployees)
        .where(and(
          eq(hrmsEmployees.tenantId, tenantId),
          eq(hrmsEmployees.userRef, userId),
          ne(hrmsEmployees.id, employeeId),
          notInArray(hrmsEmployees.status, [...EXITED_STATUSES]),
        ))
        .limit(1);
      if (holders[0]) {
        throw new HttpError(409, "LOGIN_ALREADY_LINKED", "this login is already linked to another serving employee; unlink it there first");
      }
    }

    if (previousUserRef === userId) {
      return { id: employeeId, userRef: userId, previousUserRef, changed: false };
    }

    await tx.update(hrmsEmployees)
      .set({ userRef: userId, updatedBy: ctx.actorId, updatedAt: new Date(), version: sql`${hrmsEmployees.version} + 1` })
      .where(and(eq(hrmsEmployees.id, employeeId), eq(hrmsEmployees.tenantId, tenantId)));

    await enqueue(tx, {
      topic: AUDIT, eventType: AUDIT,
      tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
      payload: {
        service: "hrms",
        action: userId === null ? "login_unlink" : "login_link",
        resourceType: "employee",
        resourceId: employeeId,
        outcome: "success",
        // oldValue/newValue are audit-service's CERT-In field-level change columns.
        oldValue: { userRef: previousUserRef },
        newValue: { userRef: userId },
        reason: body.reason,
      },
    });
    return { id: employeeId, userRef: userId, previousUserRef, changed: true };
  });

  if (result.changed) {
    await cache.invalidate(cache.makeKey(tenantId, "employee", employeeId));
    await cache.invalidateResource(tenantId, "employee");
  }
  return result;
}
