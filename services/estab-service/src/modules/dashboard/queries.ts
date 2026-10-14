import { eq, and, sql, isNull, or, gte, lte, notInArray } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { estabFiles, estabInward } from "../files/schema.js";
import { estabMeetings, estabCompliance } from "../committee/schema.js";
import { estabVehicles } from "../assets/schema.js";

/**
 * GAP-ESTAB-DASHBOARD-01: ONE definition of "open", "overdue" and "pendency" for every estab
 * count, shared with apps/web/src/lib/estab/sla.ts (isOverdue / pendencyDays):
 *  - open    = status is not closed, archived or disposed;
 *  - overdue = open AND the due date (as an IST calendar day) is before today (IST);
 *  - pendency = whole days since creation, averaged over open files.
 * Before this the dashboard counted only status='active' and compared the raw timestamp to
 * now() (server clock), so its "SLA Breached" differed from My Desk and the register.
 */
export const CLOSED_FILE_STATUSES = ["closed", "archived", "disposed"] as const;
const IST_DAY = (ts: ReturnType<typeof sql>) => sql`((${ts}) AT TIME ZONE 'Asia/Kolkata')::date`;

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
      notInArray(estabFiles.status, [...CLOSED_FILE_STATUSES]),
      sql`${estabFiles.dueBy} IS NOT NULL AND ${IST_DAY(sql`${estabFiles.dueBy}`)} < ${IST_DAY(sql`now()`)}`,
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
    .select({
      // Whole IST calendar days since creation, averaged over open files, to one decimal.
      avg: sql<number>`coalesce(round(avg(${IST_DAY(sql`now()`)} - ${IST_DAY(sql`${estabFiles.createdAt}`)}), 1), 0)::float8`,
    })
    .from(estabFiles)
    .where(and(eq(estabFiles.tenantId, tenantId), notInArray(estabFiles.status, [...CLOSED_FILE_STATUSES]))));

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
