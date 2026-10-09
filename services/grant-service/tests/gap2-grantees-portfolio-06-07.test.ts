/**
 * GAP2-GRANTS-GRANTEES-06 / -07 — real grantee portfolio metrics + stable code.
 *
 *  - listGranteeSummaries computes activeGrants (approved apps), totalGrantsReceived
 *    (completed disbursements, paise) and ucCompliancePct (validated/due) from
 *    real rows, NOT hard-coded 0s.
 *  - a grantee with one approved grant + a validated UC shows activeGrants=1 and a
 *    non-zero compliance %, while one with an overdue (unvalidated) UC shows lower.
 *  - granteeCode is a stored GR-NNNNN code (migration 0016 backfill), never a UUID
 *    fragment.
 *
 * DB-backed against the dev DB (same pattern as disbursement-approval.test.ts).
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { grantBeneficiaries, grantBeneficiaryCounters } from "../src/modules/beneficiary/schema.js";
import { grantApplications } from "../src/modules/application/schema.js";
import { grantInstallments, grantDisbursements } from "../src/modules/disbursement/schema.js";
import { grantUcStatements } from "../src/modules/utilisation/schema.js";
import { cache } from "../src/shared/infra.js";
import { listGranteeSummaries } from "../src/modules/beneficiary/queries.js";

const TENANT = "2a000000-aaaa-4000-8000-0000000000f6";
const ACTOR = "10000000-aaaa-4000-8000-0000000000f6";
const BEN_WITH = "2a000000-dddd-4000-8000-0000000000f6"; // has an approved grant + validated UC
const BEN_OVERDUE = "2a000000-eeee-4000-8000-0000000000f6"; // approved grant + unvalidated UC
const BEN_NONE = "2a000000-ffff-4000-8000-0000000000f6"; // no grants

async function wipe() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(grantUcStatements).where(eq(grantUcStatements.tenantId, TENANT));
    await tx.delete(grantDisbursements).where(eq(grantDisbursements.tenantId, TENANT));
    await tx.delete(grantInstallments).where(eq(grantInstallments.tenantId, TENANT));
    await tx.delete(grantApplications).where(eq(grantApplications.tenantId, TENANT));
    await tx.delete(grantBeneficiaries).where(eq(grantBeneficiaries.tenantId, TENANT));
    await tx.delete(grantBeneficiaryCounters).where(eq(grantBeneficiaryCounters.tenantId, TENANT));
  }));
}

async function seed() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(grantBeneficiaries).values([
      { id: BEN_WITH, tenantId: TENANT, name: "With Grants", type: "institution", granteeCode: "GR-00001", createdBy: ACTOR, updatedBy: ACTOR },
      { id: BEN_OVERDUE, tenantId: TENANT, name: "Overdue UC", type: "society", granteeCode: "GR-00002", createdBy: ACTOR, updatedBy: ACTOR },
      { id: BEN_NONE, tenantId: TENANT, name: "No Grants", type: "individual", granteeCode: "GR-00003", createdBy: ACTOR, updatedBy: ACTOR },
    ]);

    const appWith = randomUUID();
    const appOverdue = randomUUID();
    await tx.insert(grantApplications).values([
      { id: appWith, tenantId: TENANT, grantNo: "G-W", schemeId: randomUUID(), beneficiaryId: BEN_WITH, purpose: "x", amountApprovedMinor: 500000n, currency: "INR", status: "approved", approvedBy: ACTOR, createdBy: ACTOR, updatedBy: ACTOR },
      { id: appOverdue, tenantId: TENANT, grantNo: "G-O", schemeId: randomUUID(), beneficiaryId: BEN_OVERDUE, purpose: "x", amountApprovedMinor: 300000n, currency: "INR", status: "approved", approvedBy: ACTOR, createdBy: ACTOR, updatedBy: ACTOR },
    ]);

    const instWith = randomUUID();
    await tx.insert(grantInstallments).values({ id: instWith, tenantId: TENANT, applicationId: appWith, installmentNo: 1, amountMinor: 250000n, currency: "INR", status: "disbursed", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(grantDisbursements).values({ id: randomUUID(), tenantId: TENANT, installmentId: instWith, amountMinor: 250000n, currency: "INR", status: "completed", createdBy: ACTOR, updatedBy: ACTOR });

    // UC statements: BEN_WITH has a validated UC; BEN_OVERDUE has one still pending.
    await tx.insert(grantUcStatements).values([
      { id: randomUUID(), tenantId: TENANT, applicationId: appWith, period: "2026-27", status: "submitted", validationStatus: "validated", createdBy: ACTOR, updatedBy: ACTOR },
      { id: randomUUID(), tenantId: TENANT, applicationId: appOverdue, period: "2026-27", status: "submitted", validationStatus: "pending", createdBy: ACTOR, updatedBy: ACTOR },
    ]);
  }));
}

beforeEach(async () => { await wipe(); await seed(); await cache.invalidate(cache.makeKey(TENANT, "grantees", "list:100")); });
afterAll(async () => { await wipe(); await sqlClient.end(); });

describe("GAP2-GRANTS-GRANTEES-06/07", () => {
  it("computes real activeGrants / totalGrantsReceived / ucCompliancePct and stable codes", async () => {
    const list = await listGranteeSummaries(TENANT, 100);
    const byId = new Map(list.map((g) => [g.id, g]));

    const withG = byId.get(BEN_WITH)!;
    expect(withG.activeGrants).toBe(1);
    expect(withG.totalGrantsReceived).toBe(250000); // paise
    expect(withG.ucCompliancePct).toBe(100); // 1 validated / 1 due
    expect(withG.granteeCode).toBe("GR-00001");
    expect(withG.granteeCode).not.toMatch(/^[0-9a-f]{8}$/i); // not a UUID fragment

    const overdue = byId.get(BEN_OVERDUE)!;
    expect(overdue.activeGrants).toBe(1);
    expect(overdue.ucCompliancePct).toBe(0); // 0 validated / 1 due — lower than the compliant grantee
    expect(overdue.ucCompliancePct).toBeLessThan(withG.ucCompliancePct);

    const none = byId.get(BEN_NONE)!;
    expect(none.activeGrants).toBe(0);
    expect(none.totalGrantsReceived).toBe(0);
    // A no-grant grantee legitimately shows 0; the acceptance only forbids a
    // fabricated 0 for a grantee that ACTUALLY HAS grants (asserted above).
    expect(none.granteeCode).toBe("GR-00003");
  });

  it("does not fan out totalGrantsReceived across multiple installments and UC statements", async () => {
    const BEN_FAN = "2a000000-9999-4000-8000-0000000000f6";
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(grantBeneficiaries).values({ id: BEN_FAN, tenantId: TENANT, name: "Fan Out", type: "institution", granteeCode: "GR-00004", createdBy: ACTOR, updatedBy: ACTOR });
      const app = randomUUID();
      await tx.insert(grantApplications).values({ id: app, tenantId: TENANT, grantNo: "G-F", schemeId: randomUUID(), beneficiaryId: BEN_FAN, purpose: "x", amountApprovedMinor: 900000n, currency: "INR", status: "approved", approvedBy: ACTOR, createdBy: ACTOR, updatedBy: ACTOR });
      const inst1 = randomUUID();
      const inst2 = randomUUID();
      await tx.insert(grantInstallments).values([
        { id: inst1, tenantId: TENANT, applicationId: app, installmentNo: 1, amountMinor: 250000n, currency: "INR", status: "disbursed", createdBy: ACTOR, updatedBy: ACTOR },
        { id: inst2, tenantId: TENANT, applicationId: app, installmentNo: 2, amountMinor: 100000n, currency: "INR", status: "disbursed", createdBy: ACTOR, updatedBy: ACTOR },
      ]);
      await tx.insert(grantDisbursements).values([
        { id: randomUUID(), tenantId: TENANT, installmentId: inst1, amountMinor: 250000n, currency: "INR", status: "completed", createdBy: ACTOR, updatedBy: ACTOR },
        { id: randomUUID(), tenantId: TENANT, installmentId: inst2, amountMinor: 100000n, currency: "INR", status: "completed", createdBy: ACTOR, updatedBy: ACTOR },
      ]);
      await tx.insert(grantUcStatements).values([
        { id: randomUUID(), tenantId: TENANT, applicationId: app, period: "2026-27", status: "submitted", validationStatus: "validated", createdBy: ACTOR, updatedBy: ACTOR },
        { id: randomUUID(), tenantId: TENANT, applicationId: app, period: "2027-28", status: "submitted", validationStatus: "pending", createdBy: ACTOR, updatedBy: ACTOR },
      ]);
    }));
    await cache.invalidate(cache.makeKey(TENANT, "grantees", "list:100"));
    const list = await listGranteeSummaries(TENANT, 100);
    const fan = list.find((g) => g.id === BEN_FAN)!;
    expect(fan.totalGrantsReceived).toBe(350000); // 250000 + 100000, once each
    expect(fan.activeGrants).toBe(1);
    expect(fan.ucCompliancePct).toBe(50); // 1 validated / 2 due
  });
});
