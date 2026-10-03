import { and, desc, eq, sql } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { onboardingRequests as R, type OnboardingRequestRow } from "./schema.js";
import type { OnboardingStage } from "./domain.js";

export async function listOnboarding(tenantId: string, limit: number, offset: number): Promise<{ rows: OnboardingRequestRow[]; total: number }> {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(R).where(eq(R.tenantId, tenantId))
      .orderBy(desc(R.requestedAt), desc(R.id)).limit(limit).offset(offset);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(R).where(eq(R.tenantId, tenantId));
    return { rows, total: c?.n ?? 0 };
  });
}

export async function findOnboarding(tenantId: string, id: string): Promise<OnboardingRequestRow | null> {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(R).where(and(eq(R.id, id), eq(R.tenantId, tenantId))).limit(1);
    return rows[0] ?? null;
  });
}

type Tx = Pick<Parameters<Parameters<typeof scopedRead>[0]>[0], "insert" | "update">;

export async function insertOnboarding(tx: Tx, row: typeof R.$inferInsert): Promise<void> {
  await tx.insert(R).values(row);
}

/**
 * Race-safe stage move: succeeds for exactly one caller, and only while the row
 * is still in the stage the operator saw. A second operator (or a double click)
 * that read the same `from` matches zero rows and gets null.
 */
export async function moveStageConditional(
  tx: Tx, tenantId: string, id: string, from: OnboardingStage, to: OnboardingStage,
  extra: { assignedTo?: string | null | undefined; assignedToName?: string | null | undefined; provisionedTenantId?: string | null | undefined },
): Promise<OnboardingRequestRow | null> {
  const rows = await tx.update(R).set({
    stage: to,
    ...(extra.assignedTo !== undefined ? { assignedTo: extra.assignedTo } : {}),
    ...(extra.assignedToName !== undefined ? { assignedToName: extra.assignedToName } : {}),
    ...(extra.provisionedTenantId !== undefined ? { provisionedTenantId: extra.provisionedTenantId } : {}),
    updatedAt: new Date(),
    version: sql`${R.version} + 1`,
  }).where(and(eq(R.id, id), eq(R.tenantId, tenantId), eq(R.stage, from))).returning();
  return rows[0] ?? null;
}
