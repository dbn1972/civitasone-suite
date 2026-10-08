/**
 * GAP-REVENUE-ASSESSMENTS-01 — GET /v1/revenue/assessments rows must carry the
 * latest remission's status + the officer who requested it, so the web table
 * can pre-disable Approve/Reject on rows with no pending remission or that the
 * same officer raised (the server still enforces maker!=checker).
 *
 * This fails on the old repo, where listAssessments returned bare assessment
 * rows with no remissionStatus/remissionRequestedBy.
 *
 * DB-backed, no mocks: seeds assessments + remissions in the test Postgres and
 * calls the real repo.listAssessments under the tenant GUC.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { assessments, remissions } from "../src/modules/assessment/schema.js";
import { listAssessments } from "../src/modules/assessment/repo.js";
import { cache } from "../src/shared/infra.js";
import { SERVICE } from "../src/topics.js";

const TENANT = "a5e50000-0000-4000-8000-000000a55e55";
const ASSESSEE = "a5e50000-0000-4000-8000-0000000000ee";
const RATE_HEAD = "a5e50000-0000-4000-8000-0000000ea7e0";
const MAKER = "a5e50000-0000-4000-8000-00000000a000";
const ACTOR = "a5e50000-0000-4000-8000-0000000ac702";

async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(remissions).where(eq(remissions.tenantId, TENANT));
      await tx.delete(assessments).where(eq(assessments.tenantId, TENANT));
    }),
  );
  await cache.invalidate(`${SERVICE}:${TENANT}:assessments`);
}

async function seedAssessment(fy: string): Promise<string> {
  return runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .insert(assessments)
        .values({
          id: randomUUID(), tenantId: TENANT, assesseeId: ASSESSEE, rateHeadId: RATE_HEAD,
          financialYear: fy, baseValue: 1000000n, exemptions: [], status: "active",
          createdBy: ACTOR, updatedBy: ACTOR,
        })
        .returning({ id: assessments.id });
      return row!.id;
    }),
  );
}

async function seedRemission(assessmentId: string, status: string, maker: string) {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(remissions).values({
        id: randomUUID(), tenantId: TENANT, assessmentId, reason: "flood relief",
        remissionPercent: 25, status, makerUserId: maker,
      });
    }),
  );
}

beforeAll(async () => { await clean(); });
beforeEach(async () => { await clean(); });
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("listAssessments remission enrichment (GAP-REVENUE-ASSESSMENTS-01, real DB)", () => {
  it("reports remissionStatus 'none' and remissionRequestedBy null for an assessment with no remission", async () => {
    await seedAssessment("2026-27");
    const { data } = await listAssessments(TENANT, { limit: 50, offset: 0 });
    expect(data).toHaveLength(1);
    expect(data[0]!.remissionStatus).toBe("none");
    expect(data[0]!.remissionRequestedBy).toBeNull();
  });

  it("reports the pending remission's status and the officer who requested it", async () => {
    const id = await seedAssessment("2026-27");
    await seedRemission(id, "pending", MAKER);

    const { data } = await listAssessments(TENANT, { limit: 50, offset: 0 });
    const row = data.find((a) => a.id === id)!;
    expect(row.remissionStatus).toBe("pending");
    expect(row.remissionRequestedBy).toBe(MAKER);
  });

  it("reflects the LATEST remission when an assessment has more than one", async () => {
    const id = await seedAssessment("2026-27");
    await seedRemission(id, "rejected", MAKER);
    // small delay so created_at ordering is deterministic
    await new Promise((r) => setTimeout(r, 10));
    await seedRemission(id, "pending", MAKER);

    const { data } = await listAssessments(TENANT, { limit: 50, offset: 0 });
    const row = data.find((a) => a.id === id)!;
    expect(row.remissionStatus).toBe("pending"); // newest wins
  });
});
