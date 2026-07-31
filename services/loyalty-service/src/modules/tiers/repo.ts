/**
 * tiers/repo.ts — Database operations for tier definitions and assignments.
 */
import { eq, and, sql, desc, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import {
  tierDefinitions,
  tierAssignments,
  type TierDefinitionRow,
  type TierDefinitionInsert,
  type TierAssignmentRow,
  type TierAssignmentInsert,
} from "./schema.js";

export function toDefView(r: TierDefinitionRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    programId: r.programId,
    name: r.name,
    level: r.level,
    minPointsThreshold: r.minPointsThreshold.toString(),
    benefits: r.benefits,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toAssignmentView(r: TierAssignmentRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    enrolmentId: r.enrolmentId,
    tierDefinitionId: r.tierDefinitionId,
    assignedAt: r.assignedAt.toISOString(),
    expiresAt: r.expiresAt?.toISOString() ?? null,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function listDefinitions(
  tenantId: string,
  programId: string,
): Promise<TierDefinitionRow[]> {
  return scopedRead((tx) =>
    tx
      .select()
      .from(tierDefinitions)
      .where(and(eq(tierDefinitions.tenantId, tenantId), eq(tierDefinitions.programId, programId)))
      .orderBy(tierDefinitions.level),
  );
}

export async function findCurrentAssignment(
  tenantId: string,
  enrolmentId: string,
): Promise<TierAssignmentRow | null> {
  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(tierAssignments)
      .where(and(eq(tierAssignments.tenantId, tenantId), eq(tierAssignments.enrolmentId, enrolmentId)))
      .orderBy(desc(tierAssignments.assignedAt))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listAssignmentHistory(
  tenantId: string,
  enrolmentId: string,
  limit: number,
  offset: number,
): Promise<{ rows: TierAssignmentRow[]; total: number }> {
  const where: SQL = and(eq(tierAssignments.tenantId, tenantId), eq(tierAssignments.enrolmentId, enrolmentId))!;

  const rows = await scopedRead((tx) =>
    tx.select().from(tierAssignments).where(where).orderBy(desc(tierAssignments.assignedAt)).limit(limit).offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(tierAssignments).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}

export async function insertAssignment(tx: ScopedTx, row: TierAssignmentInsert): Promise<void> {
  await tx.insert(tierAssignments).values(row);
}
