/**
 * G15 — MoU milestone governance: Postgres reads.
 *
 * Every read goes through `scopedRead`, which wraps the query in a transaction
 * so the TenantRouter sets the `app.tenant_id` GUC. Without it, the FORCE RLS
 * policies on these tables return zero rows for the NOBYPASSRLS service role.
 */
import { eq, and, sql, asc } from "drizzle-orm";
import { scopedRead, type Db } from "../../shared/db.js";
import { contractMilestones } from "../contracts/schema.js";
import {
  penaltyTerms,
  penaltyApplications,
  reviewSchedules,
  type PenaltyTermRow,
  type PenaltyApplicationRow,
  type ReviewScheduleRow,
} from "./schema.js";

export type MilestoneRow = typeof contractMilestones.$inferSelect;

// ── Milestones (contracts.contract_milestones — owned by the contracts module) ──

export async function findMilestoneById(id: string, tenantId: string): Promise<MilestoneRow | undefined> {
  return scopedRead(async (tx: Db) => {
    const [row] = await tx
      .select()
      .from(contractMilestones)
      .where(and(eq(contractMilestones.id, id), eq(contractMilestones.tenantId, tenantId)))
      .limit(1);
    return row;
  });
}

export async function listMilestones(
  tenantId: string,
  opts: { contractId?: string; status?: string; limit: number; offset: number },
): Promise<{ data: MilestoneRow[]; total: number }> {
  return scopedRead(async (tx: Db) => {
    const conditions = [eq(contractMilestones.tenantId, tenantId)];
    if (opts.contractId) conditions.push(eq(contractMilestones.contractId, opts.contractId));
    if (opts.status) conditions.push(eq(contractMilestones.status, opts.status));
    const where = and(...conditions);

    const [count] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(contractMilestones)
      .where(where);

    const data = await tx
      .select()
      .from(contractMilestones)
      .where(where)
      .orderBy(asc(contractMilestones.ordinal), asc(contractMilestones.dueDate))
      .limit(opts.limit)
      .offset(opts.offset);

    return { data, total: count?.count ?? 0 };
  });
}

// ── Penalty terms ──────────────────────────────────────────────────────────

export async function findPenaltyTermById(id: string, tenantId: string): Promise<PenaltyTermRow | undefined> {
  return scopedRead(async (tx: Db) => {
    const [row] = await tx
      .select()
      .from(penaltyTerms)
      .where(and(eq(penaltyTerms.id, id), eq(penaltyTerms.tenantId, tenantId)))
      .limit(1);
    return row;
  });
}

export async function listPenaltyTerms(
  tenantId: string,
  opts: { contractId?: string; triggerType?: string; limit: number; offset: number },
): Promise<{ data: PenaltyTermRow[]; total: number }> {
  return scopedRead(async (tx: Db) => {
    const conditions = [eq(penaltyTerms.tenantId, tenantId)];
    if (opts.contractId) conditions.push(eq(penaltyTerms.contractId, opts.contractId));
    if (opts.triggerType) conditions.push(eq(penaltyTerms.triggerType, opts.triggerType));
    const where = and(...conditions);

    const [count] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(penaltyTerms)
      .where(where);

    const data = await tx
      .select()
      .from(penaltyTerms)
      .where(where)
      .orderBy(asc(penaltyTerms.termCode))
      .limit(opts.limit)
      .offset(opts.offset);

    return { data, total: count?.count ?? 0 };
  });
}

export async function listPenaltyApplications(
  tenantId: string,
  opts: { contractId?: string; limit: number; offset: number },
): Promise<{ data: PenaltyApplicationRow[]; total: number }> {
  return scopedRead(async (tx: Db) => {
    const conditions = [eq(penaltyApplications.tenantId, tenantId)];
    if (opts.contractId) conditions.push(eq(penaltyApplications.contractId, opts.contractId));
    const where = and(...conditions);

    const [count] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(penaltyApplications)
      .where(where);

    const data = await tx
      .select()
      .from(penaltyApplications)
      .where(where)
      .orderBy(asc(penaltyApplications.appliedAt))
      .limit(opts.limit)
      .offset(opts.offset);

    return { data, total: count?.count ?? 0 };
  });
}

// ── Review schedules ───────────────────────────────────────────────────────

export async function findReviewScheduleById(id: string, tenantId: string): Promise<ReviewScheduleRow | undefined> {
  return scopedRead(async (tx: Db) => {
    const [row] = await tx
      .select()
      .from(reviewSchedules)
      .where(and(eq(reviewSchedules.id, id), eq(reviewSchedules.tenantId, tenantId)))
      .limit(1);
    return row;
  });
}

export async function listReviewSchedules(
  tenantId: string,
  opts: { contractId?: string; status?: string; limit: number; offset: number },
): Promise<{ data: ReviewScheduleRow[]; total: number }> {
  return scopedRead(async (tx: Db) => {
    const conditions = [eq(reviewSchedules.tenantId, tenantId)];
    if (opts.contractId) conditions.push(eq(reviewSchedules.contractId, opts.contractId));
    if (opts.status) conditions.push(eq(reviewSchedules.status, opts.status));
    const where = and(...conditions);

    const [count] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(reviewSchedules)
      .where(where);

    const data = await tx
      .select()
      .from(reviewSchedules)
      .where(where)
      .orderBy(asc(reviewSchedules.nextReviewDate))
      .limit(opts.limit)
      .offset(opts.offset);

    return { data, total: count?.count ?? 0 };
  });
}
