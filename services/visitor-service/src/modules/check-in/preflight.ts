/**
 * visitor-service: synchronous pre-flight for POST /v1/visitor/check-ins.
 * Kept out of routes.ts so the route table stays declarative and tests can stub it.
 */
import { pino } from "pino";
import { and, eq } from "drizzle-orm";
import { HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { digitalPasses } from "../digital-pass/schema.js";
import { isRevoked } from "../digital-pass/revocation-store.js";
import { checkIn as domainCheckIn, DomainError, type CheckInStatus } from "./domain.js";
import { evaluateCheckInWindow, loadCheckInWindowPolicy } from "./window.js";

const routeLog = pino({ name: "check-in-preflight" });

/**
 * Synchronous pre-flight for POST /check-ins: refuse with a 422 the client can act on, instead of a
 * 202 followed by a dead-letter. The consumer re-asserts all of this at commit time (fail closed).
 *   422 UNKNOWN_PASS, 422 PASS_REVOKED, 422 PASS_NOT_YET_VALID, 422 PASS_EXPIRED.
 */
export async function assertPassCheckInAllowed(tenantId: string, passId: string, timestamp: string | undefined, correlationId: string): Promise<void> {
  const { pass, policy } = await scopedRead(async (tx) => {
    const rows = await tx.select({
      validFrom: digitalPasses.validFrom, validUntil: digitalPasses.validUntil,
      status: digitalPasses.status, revoked: digitalPasses.revoked, passType: digitalPasses.passType,
    }).from(digitalPasses)
      .where(and(eq(digitalPasses.id, passId), eq(digitalPasses.tenantId, tenantId)))
      .limit(1);
    return { pass: rows[0], policy: rows[0] ? await loadCheckInWindowPolicy(tx, tenantId) : undefined };
  });
  const refuse = (status: number, code: string, message: string): never => {
    routeLog.warn({ tenantId, correlationId, passId, code, event: "check_in_refused" }, message);
    throw new HttpError(status, code, message);
  };
  if (!pass || !policy) return refuse(422, "UNKNOWN_PASS", `pass '${passId}' does not exist`);
  if (pass.revoked || pass.status === "revoked" || (await isRevoked(tenantId, passId))) {
    return refuse(422, "PASS_REVOKED", `pass '${passId}' has been revoked`);
  }
  const result = evaluateCheckInWindow(timestamp ? new Date(timestamp) : new Date(), pass.validFrom, pass.validUntil, policy);
  if (!result.ok) refuse(422, result.code, result.message);
  try {
    domainCheckIn(pass.status as CheckInStatus, { passType: pass.passType as never });
  } catch (err) {
    if (err instanceof DomainError) refuse(422, err.code, err.message);
    throw err;
  }
}

