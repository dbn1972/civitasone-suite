import { eq, and, sql, lt, isNull, or, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { estabFiles, estabInward } from "../files/schema.js";
import { estabMeetings, estabCompliance } from "../committee/schema.js";
import { estabVehicles } from "../assets/schema.js";

export async function getDashboard(tenantId: string) {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const [pendingFiles] = await db.transaction((tx) => tx
    .select({ count: sql<number>`count(*)::int` })
    .from(estabFiles)
    .where(and(eq(estabFiles.tenantId, tenantId), eq(estabFiles.status, "active"))));

  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const [slaBreached] = await db.transaction((tx) => tx
    .select({ count: sql<number>`count(*)::int` })
    .from(estabFiles)
    .where(and(
      eq(estabFiles.tenantId, tenantId),
      eq(estabFiles.status, "active"),
      lt(estabFiles.dueBy, now),
    )));

  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const [dakPending] = await db.transaction((tx) => tx
    .select({ count: sql<number>`count(*)::int` })
    .from(estabInward)
    .where(and(
      eq(estabInward.tenantId, tenantId),
      eq(estabInward.status, "received"),
      or(isNull(estabInward.fileId)),
    )));

  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const [avgPendency] = await db.transaction((tx) => tx
    .select({ avg: sql<number>`coalesce(avg(extract(epoch from (now() - ${estabFiles.createdAt}))/86400), 0)::int` })
    .from(estabFiles)
    .where(and(eq(estabFiles.tenantId, tenantId), eq(estabFiles.status, "active"))));

  let meetingsToday = 0;
  try {
    // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
    // before this read — a bare db.select() runs with no RLS GUC set.
    const [m] = await db.transaction((tx) => tx.select({ count: sql<number>`count(*)::int` }).from(estabMeetings)
      .where(and(
        eq(estabMeetings.tenantId, tenantId),
        gte(estabMeetings.whenAt, todayStart),
        lte(estabMeetings.whenAt, todayEnd),
      )));
    meetingsToday = m?.count ?? 0;
  } catch { /* table may be empty */ }

  let vehiclesInUse = 0;
  try {
    // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
    // before this read — a bare db.select() runs with no RLS GUC set.
    const [v] = await db.transaction((tx) => tx.select({ count: sql<number>`count(*)::int` }).from(estabVehicles)
      .where(and(eq(estabVehicles.tenantId, tenantId), eq(estabVehicles.status, "in_use"))));
    vehiclesInUse = v?.count ?? 0;
  } catch { /* ok */ }

  let complianceItemsDue = 0;
  try {
    // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
    // before this read — a bare db.select() runs with no RLS GUC set.
    const [c] = await db.transaction((tx) => tx.select({ count: sql<number>`count(*)::int` }).from(estabCompliance)
      .where(and(eq(estabCompliance.tenantId, tenantId), eq(estabCompliance.status, "pending"))));
    complianceItemsDue = c?.count ?? 0;
  } catch { /* ok */ }

  return {
    filesPending: pendingFiles?.count ?? 0,
    meetingsToday,
    vehiclesInUse,
    complianceItemsDue,
    slaBreached: slaBreached?.count ?? 0,
    dakPending: dakPending?.count ?? 0,
    avgPendencyDays: avgPendency?.avg ?? 0,
  };
}
