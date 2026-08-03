import { and, desc, eq, sql } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { onboardingCases, type OnboardingCaseRow, type OnboardingCaseView } from "./schema.js";

export function toView(r: OnboardingCaseRow): OnboardingCaseView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    dealId: r.dealId,
    accountId: r.accountId,
    stage: r.stage,
    kycStatus: r.kycStatus,
    kycReference: r.kycReference,
    kycVerifiedAt: r.kycVerifiedAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
    cancellationReason: r.cancellationReason,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<OnboardingCaseView | null> {
  const rows = await scopedRead((tx) => tx.select().from(onboardingCases)
    .where(and(eq(onboardingCases.id, id), eq(onboardingCases.tenantId, tenantId)))
    .limit(1));
  const row = rows[0];
  return row ? toView(row) : null;
}

export async function findByDealId(dealId: string, tenantId: string): Promise<OnboardingCaseView | null> {
  const rows = await scopedRead((tx) => tx.select().from(onboardingCases)
    .where(and(eq(onboardingCases.dealId, dealId), eq(onboardingCases.tenantId, tenantId)))
    .limit(1));
  const row = rows[0];
  return row ? toView(row) : null;
}

export interface ListFilters {
  stage?: string;
  accountId?: string;
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  filters: ListFilters = {},
): Promise<{ rows: OnboardingCaseView[]; total: number }> {
  const where = and(
    eq(onboardingCases.tenantId, tenantId),
    ...(filters.stage ? [eq(onboardingCases.stage, filters.stage)] : []),
    ...(filters.accountId ? [eq(onboardingCases.accountId, filters.accountId)] : []),
  );
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(onboardingCases)
      .where(where)
      .orderBy(desc(onboardingCases.updatedAt))
      .limit(limit)
      .offset(offset);
    const counted = await tx.select({ total: sql<number>`count(*)::int` }).from(onboardingCases).where(where);
    return { rows: rows.map(toView), total: counted[0]?.total ?? 0 };
  });
}
