/**
 * PERF-005 regression tests — grant-service tranche.
 *
 * Covers the 3 grant sites named in docs/ENTERPRISE-GAP-REPORT-2026-09-07.md's
 * PERF-005 row:
 *   - disbursement/queries.ts::listGrantReleases      (was 3N+1)
 *   - utilisation/queries.ts::listUtilizationCerts    (was 2N+1)
 *   - disbursement/repo.ts::findDisbursementsByApplicationId (was N+1)
 *
 * Query counting uses the real driver-level counter from @civitasone/db
 * (countQueriesDuring — wraps postgres-js's own `debug` hook, not a mock), so
 * a "query" here is an actual protocol round trip, including the
 * BEGIN/SET-GUC/COMMIT statements runWithTenant()/scopedRead() wrap every
 * call in — which is why the bounded constant per function is >1 even though
 * each is "a handful of SQL statements", not literally 1.
 *
 * The primary assertion in each test is O(1)-not-O(N): the exact same
 * function issues the SAME query count for a tiny (3-row) tenant and a large
 * (30-row) tenant. That is what actually distinguishes "batched" from
 * "N+1" — a per-row-loop's count scales with N; a batch loader's does not.
 * A loose upper-bound sanity check backs it up in case both measurements
 * were wrong in the same direction.
 *
 * Response-shape parity: each test also asserts the returned data has the
 * expected length and that every row's derived fields (grantNo, granteeName)
 * correctly resolve through the installment -> application -> beneficiary (or
 * application -> beneficiary) chain, matching what the original per-row-loop
 * code computed.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant, countQueriesDuring } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { grantBeneficiaries } from "../src/modules/beneficiary/schema.js";
import { grantApplications } from "../src/modules/application/schema.js";
import { grantInstallments, grantDisbursements } from "../src/modules/disbursement/schema.js";
import { grantUcStatements } from "../src/modules/utilisation/schema.js";
import { listGrantReleases } from "../src/modules/disbursement/queries.js";
import { listUtilizationCerts } from "../src/modules/utilisation/queries.js";
import { findDisbursementsByApplicationId } from "../src/modules/disbursement/repo.js";

const ACTOR = "50000000-aaaa-4000-8000-000000000001";
const SMALL_N = 3;
const LARGE_N = 30;

async function seedChain(tenant: string, n: number) {
  const beneficiaries = Array.from({ length: n }, (_, i) => ({
    id: randomUUID(), tenantId: tenant, name: `Beneficiary ${i}`,
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  const applications = beneficiaries.map((b, i) => ({
    id: randomUUID(), tenantId: tenant, grantNo: `PERF005-G-${i}`,
    schemeId: randomUUID(), beneficiaryId: b.id, purpose: "perf-005 test",
    amountRequestedMinor: 100000n, amountApprovedMinor: 100000n,
    status: "approved", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  const installments = applications.map((a) => ({
    id: randomUUID(), tenantId: tenant, applicationId: a.id, installmentNo: 1,
    amountMinor: 50000n, status: "pending", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  const disbursements = installments.map((inst, i) => ({
    id: randomUUID(), tenantId: tenant, installmentId: inst.id,
    amountMinor: 50000n, status: i % 2 === 0 ? "completed" : "initiated",
    pfmsTxnId: `PFMS-${i}`, disbursedAt: new Date(), createdBy: ACTOR, updatedBy: ACTOR,
  }));
  const ucStatements = applications.map((a) => ({
    id: randomUUID(), tenantId: tenant, applicationId: a.id, period: "2026-04",
    releasedMinor: 50000n, utilisedMinor: 40000n, status: "submitted",
    submittedAt: new Date(), createdBy: ACTOR, updatedBy: ACTOR,
  }));

  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.insert(grantBeneficiaries).values(beneficiaries);
    await tx.insert(grantApplications).values(applications);
    await tx.insert(grantInstallments).values(installments);
    await tx.insert(grantDisbursements).values(disbursements);
    await tx.insert(grantUcStatements).values(ucStatements);
  }));

  return { beneficiaries, applications, installments, disbursements, ucStatements };
}

async function wipe(tenant: string) {
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.delete(grantUcStatements).where(eq(grantUcStatements.tenantId, tenant));
    await tx.delete(grantDisbursements).where(eq(grantDisbursements.tenantId, tenant));
    await tx.delete(grantInstallments).where(eq(grantInstallments.tenantId, tenant));
    await tx.delete(grantApplications).where(eq(grantApplications.tenantId, tenant));
    await tx.delete(grantBeneficiaries).where(eq(grantBeneficiaries.tenantId, tenant));
  }));
}

afterAll(async () => { await sqlClient.end(); });

describe("PERF-005 — grant-service N+1 fixes", () => {
  it("listGrantReleases: query count is O(1) not O(N), and shape/content is correct (was 3N+1)", async () => {
    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    const seedSmall = await seedChain(tenantSmall, SMALL_N);
    const seedLarge = await seedChain(tenantLarge, LARGE_N);
    try {
      const { queryCount: countSmall } = await countQueriesDuring(() => listGrantReleases(tenantSmall, 100));
      const { result: releases, queryCount: countLarge } = await countQueriesDuring(() => listGrantReleases(tenantLarge, 100));

      // O(1): identical round-trip count whether the tenant has 3 rows or 30.
      // The old 3N+1 loop code would have made ~27 more queries for the
      // 30-row tenant than the 3-row one.
      expect(countLarge).toBe(countSmall);
      expect(countLarge).toBeLessThanOrEqual(20); // sanity bound, not the primary assertion

      expect(releases).toHaveLength(LARGE_N);
      const byInstallment = new Map(seedLarge.installments.map((i) => [i.id, i]));
      const byApplication = new Map(seedLarge.applications.map((a) => [a.id, a]));
      const byBeneficiary = new Map(seedLarge.beneficiaries.map((b) => [b.id, b]));
      for (const release of releases) {
        const disb = seedLarge.disbursements.find((d) => d.id === release.id);
        expect(disb).toBeDefined();
        const inst = byInstallment.get(disb!.installmentId)!;
        const app = byApplication.get(inst.applicationId)!;
        const ben = byBeneficiary.get(app.beneficiaryId)!;
        expect(release.grantNo).toBe(app.grantNo);
        expect(release.granteeName).toBe(ben.name);
        expect(release.status).toBe(disb!.status === "completed" ? "credited" : "processed");
      }
      void seedSmall;
    } finally {
      await wipe(tenantSmall);
      await wipe(tenantLarge);
    }
  });

  it("listUtilizationCerts: query count is O(1) not O(N), and shape/content is correct (was 2N+1)", async () => {
    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    await seedChain(tenantSmall, SMALL_N);
    const seedLarge = await seedChain(tenantLarge, LARGE_N);
    try {
      const { queryCount: countSmall } = await countQueriesDuring(() => listUtilizationCerts(tenantSmall, 100));
      const { result: certs, queryCount: countLarge } = await countQueriesDuring(() => listUtilizationCerts(tenantLarge, 100));

      expect(countLarge).toBe(countSmall);
      expect(countLarge).toBeLessThanOrEqual(16);

      expect(certs).toHaveLength(LARGE_N);
      const byApplication = new Map(seedLarge.applications.map((a) => [a.id, a]));
      const byBeneficiary = new Map(seedLarge.beneficiaries.map((b) => [b.id, b]));
      for (const cert of certs) {
        const uc = seedLarge.ucStatements.find((u) => u.id === cert.id)!;
        const app = byApplication.get(uc.applicationId)!;
        const ben = byBeneficiary.get(app.beneficiaryId)!;
        expect(cert.grantNo).toBe(app.grantNo);
        expect(cert.granteeName).toBe(ben.name);
      }
    } finally {
      await wipe(tenantSmall);
      await wipe(tenantLarge);
    }
  });

  it("findDisbursementsByApplicationId: query count is O(1) not O(N) across installment count (was N+1)", async () => {
    async function seedApplicationWithInstallments(tenant: string, n: number) {
      const beneficiary = { id: randomUUID(), tenantId: tenant, name: "Solo Beneficiary", createdBy: ACTOR, updatedBy: ACTOR };
      const application = {
        id: randomUUID(), tenantId: tenant, grantNo: "PERF005-SOLO", schemeId: randomUUID(),
        beneficiaryId: beneficiary.id, purpose: "perf-005 test", amountRequestedMinor: 100000n,
        amountApprovedMinor: 100000n, status: "approved", createdBy: ACTOR, updatedBy: ACTOR,
      };
      const installments = Array.from({ length: n }, (_, i) => ({
        id: randomUUID(), tenantId: tenant, applicationId: application.id, installmentNo: i + 1,
        amountMinor: 10000n, status: "pending", createdBy: ACTOR, updatedBy: ACTOR,
      }));
      const disbursements = installments.map((inst, i) => ({
        id: randomUUID(), tenantId: tenant, installmentId: inst.id, amountMinor: 10000n,
        status: "completed", pfmsTxnId: `PFMS-SOLO-${i}`, createdBy: ACTOR, updatedBy: ACTOR,
      }));
      await runWithTenant(tenant, () => db.transaction(async (tx) => {
        await tx.insert(grantBeneficiaries).values(beneficiary);
        await tx.insert(grantApplications).values(application);
        await tx.insert(grantInstallments).values(installments);
        await tx.insert(grantDisbursements).values(disbursements);
      }));
      return { application, disbursements };
    }

    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    const small = await seedApplicationWithInstallments(tenantSmall, SMALL_N);
    const large = await seedApplicationWithInstallments(tenantLarge, LARGE_N);
    try {
      const { queryCount: countSmall } = await countQueriesDuring(() =>
        findDisbursementsByApplicationId(small.application.id, tenantSmall));
      const { result: found, queryCount: countLarge } = await countQueriesDuring(() =>
        findDisbursementsByApplicationId(large.application.id, tenantLarge));

      expect(countLarge).toBe(countSmall);
      expect(countLarge).toBeLessThanOrEqual(10);

      expect(found).toHaveLength(LARGE_N);
      expect(new Set(found.map((d) => d.id))).toEqual(new Set(large.disbursements.map((d) => d.id)));
    } finally {
      await wipe(tenantSmall);
      await wipe(tenantLarge);
    }
  });
});
