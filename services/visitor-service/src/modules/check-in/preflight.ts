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
import { getPolicyNumber } from "../config-registry/policy.js";
import { resolveCheckInTime } from "./trusted-time.js";
import { evaluateCheckInWindow, loadCheckInWindowPolicy } from "./window.js";

const routeLog = pino({ name: "check-in-preflight" });

/**
 * Synchronous pre-flight for POST /check-ins: refuse with a 422 the client can act on, instead of a
 * 202 followed by a dead-letter. The consumer re-asserts all of this at commit time (fail closed).
 *   422 UNKNOWN_PASS, 422 PASS_REVOKED, 422 PASS_NOT_YET_VALID, 422 PASS_EXPIRED.
 */
export async function assertPassCheckInAllowed(
  tenantId: string, passId: string,
  input: { offlineRecorded?: boolean | null | undefined; timestamp?: string | null | undefined },
  correlationId: string, actorId?: string | undefined,
): Promise<string> {
  const { pass, policy, maxOfflineAgeMs } = await scopedRead(async (tx) => {
    const rows = await tx.select({
      validFrom: digitalPasses.validFrom, validUntil: digitalPasses.validUntil,
      status: digitalPasses.status, revoked: digitalPasses.revoked, passType: digitalPasses.passType,
    }).from(digitalPasses)
      .where(and(eq(digitalPasses.id, passId), eq(digitalPasses.tenantId, tenantId)))
      .limit(1);
    return {
      pass: rows[0],
      policy: rows[0] ? await loadCheckInWindowPolicy(tx, tenantId) : undefined,
      maxOfflineAgeMs: (await getPolicyNumber(tx, tenantId, "check_in.offline_max_age_hours")) * 3_600_000,
    };
  });
  const refuse = (status: number, code: string, message: string): never => {
    routeLog.warn({ tenantId, correlationId, passId, code, event: "check_in_refused" }, message);
    throw new HttpError(status, code, message);
  };
  if (!pass || !policy) return refuse(422, "UNKNOWN_PASS", `pass '${passId}' does not exist`);
  if (pass.revoked || pass.status === "revoked" || (await isRevoked(tenantId, passId))) {
    return refuse(422, "PASS_REVOKED", `pass '${passId}' has been revoked`);
  }
  // SECURITY: server time for live check-ins; a client timestamp only for a bounded offline record.
  const when = resolveCheckInTime(input, new Date(), maxOfflineAgeMs);
  if (!when.ok) return refuse(422, when.code, when.message);
  const result = evaluateCheckInWindow(when.at, pass.validFrom, pass.validUntil, policy);
  if (!result.ok) refuse(422, result.code, result.message);
  try {
    domainCheckIn(pass.status as CheckInStatus, { passType: pass.passType as never });
  } catch (err) {
    if (err instanceof DomainError) refuse(422, err.code, err.message);
    throw err;
  }
  if (when.offline) {
    // Audit trail for check-ins admitted on the strength of a client-claimed time.
    routeLog.info(
      { tenantId, correlationId, passId, actorId, claimedAt: when.at.toISOString(), event: "offline_check_in_accepted" },
      "offline-recorded check-in accepted with client timestamp",
    );
  }
  return when.at.toISOString();
}

