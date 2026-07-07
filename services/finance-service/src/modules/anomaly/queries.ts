/**
 * Anomaly Detection Queries
 *
 * Read operations for anomaly detection module.
 *
 * Requirements: 11.6
 */
import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { financeAnomalies } from "./schema.js";
import type { AnomalyStatus } from "./domain.js";

export interface AnomalyRecord {
  id: string;
  tenantId: string;
  transactionId: string;
  anomalyType: string;
  severity: string;
  status: string;
  zScore: string | null;
  factors: unknown;
  vendorId: string | null;
  categoryId: string | null;
  amountPaise: string | null;
  dismissedBy: string | null;
  dismissReason: string | null;
  dismissedAt: Date | null;
  correlationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * List anomalies with optional status filter, paginated.
 */
export async function listAnomalies(
  tenantId: string,
  options: { status?: AnomalyStatus | undefined; page: number; pageSize: number }
): Promise<{ data: AnomalyRecord[]; total: number }> {
  const { status, page, pageSize } = options;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(financeAnomalies.tenantId, tenantId)];
  if (status) {
    conditions.push(eq(financeAnomalies.status, status));
  }

  const whereClause = and(...conditions);

  const [rows, countResult] = await Promise.all([
    db
      .select()
      .from(financeAnomalies)
      .where(whereClause)
      .orderBy(desc(financeAnomalies.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(financeAnomalies)
      .where(whereClause),
  ]);

  const total = countResult[0]?.count ?? 0;

  return { data: rows as unknown as AnomalyRecord[], total };
}

/**
 * Get a single anomaly by ID (tenant-scoped).
 */
export async function getAnomalyById(
  tenantId: string,
  anomalyId: string
): Promise<AnomalyRecord | null> {
  const rows = await db
    .select()
    .from(financeAnomalies)
    .where(
      and(
        eq(financeAnomalies.id, anomalyId),
        eq(financeAnomalies.tenantId, tenantId)
      )
    )
    .limit(1);

  return (rows[0] as unknown as AnomalyRecord) ?? null;
}

/**
 * Check if a transaction already has a dismissed anomaly (prevents re-flagging).
 *
 * Requirements: 11.7
 */
export async function isTransactionDismissed(
  tenantId: string,
  transactionId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: financeAnomalies.id })
    .from(financeAnomalies)
    .where(
      and(
        eq(financeAnomalies.tenantId, tenantId),
        eq(financeAnomalies.transactionId, transactionId),
        eq(financeAnomalies.status, "dismissed")
      )
    )
    .limit(1);

  return rows.length > 0;
}
