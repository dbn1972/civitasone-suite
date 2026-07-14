/**
 * visitor-service: check-in reads — currently-inside ("active") visitors.
 *
 * Backs the guard-console live-occupancy endpoint (GET /v1/visitor/check-ins/active).
 * This is the NORMAL, role-gated read of "who is inside now" — distinct from the
 * evacuation roster (GET /v1/visitor/evacuation/roster), which is intentionally
 * fail-closed IP-allowlisted break-glass and thus 403s the everyday guard UI.
 *
 * "Inside now" = a digital pass currently in `checked_in` status (the check-in
 * consumer sets it on entry and clears it on exit). Tenant + optional location
 * scoped; RLS-enforced because every read runs through `scopedRead` (GUC-set tx)
 * AND carries an explicit tenant_id predicate. Only the fields a guard needs are
 * returned — name, check-in time, host, location, overstay flag — never the
 * visitor's phone/email/identity document.
 */
import { and, eq, inArray } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { checkIns } from "./schema.js";
import { digitalPasses } from "../digital-pass/schema.js";
import { visitRequests } from "../visit-request/schema.js";

export interface ActiveVisitor {
  passId: string;
  locationId: string;
  visitorName: string;
  hostEmployeeId: string;
  checkInTime: string | null;
  validUntil: string | null;
  overstay: boolean;
}

/**
 * List the visitors currently inside for a tenant (optionally scoped to one
 * location). `now` is injectable for deterministic overstay tests.
 */
export async function listActiveVisitors(
  tenantId: string, locationId?: string, now: Date = new Date(),
): Promise<ActiveVisitor[]> {
  const conditions = [
    eq(digitalPasses.tenantId, tenantId),
    eq(digitalPasses.status, "checked_in"),
  ];
  if (locationId) conditions.push(eq(digitalPasses.locationId, locationId));

  const rows = await scopedRead((tx) => tx
    .select({
      passId: digitalPasses.id,
      locationId: digitalPasses.locationId,
      validUntil: digitalPasses.validUntil,
      visitorName: visitRequests.visitorName,
      hostEmployeeId: visitRequests.hostEmployeeId,
    })
    .from(digitalPasses)
    .innerJoin(visitRequests, eq(visitRequests.id, digitalPasses.visitRequestId))
    .where(and(...conditions)));

  if (rows.length === 0) return [];

  // Resolve each pass's latest inbound check-in timestamp for the roster display.
  const passIds = rows.map((r) => r.passId);
  const ciRows = await scopedRead((tx) => tx
    .select({ passId: checkIns.passId, timestamp: checkIns.timestamp })
    .from(checkIns)
    .where(and(
      eq(checkIns.tenantId, tenantId),
      eq(checkIns.direction, "in"),
      inArray(checkIns.passId, passIds),
    )));
  const latestInByPass = new Map<string, Date>();
  for (const c of ciRows) {
    const cur = latestInByPass.get(c.passId);
    if (!cur || c.timestamp.getTime() > cur.getTime()) latestInByPass.set(c.passId, c.timestamp);
  }

  return rows.map((r) => {
    const ci = latestInByPass.get(r.passId) ?? null;
    return {
      passId: r.passId,
      locationId: r.locationId,
      visitorName: r.visitorName,
      hostEmployeeId: r.hostEmployeeId,
      checkInTime: ci ? ci.toISOString() : null,
      validUntil: r.validUntil ? r.validUntil.toISOString() : null,
      overstay: r.validUntil ? r.validUntil.getTime() < now.getTime() : false,
    };
  });
}
