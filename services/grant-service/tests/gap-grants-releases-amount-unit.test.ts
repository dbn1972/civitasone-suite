/**
 * GAP-GRANTS-DISBURSEMENTS-DETAIL-02 (BACKEND verify): pins the unit of
 * GrantRelease.amount returned by GET /v1/grants/releases.
 *
 * Finding: grant_disbursements.amount_minor is bigint PAISE (CLAUDE.md rule 11),
 * and the releases read model (disbursement/queries.ts listGrantReleases) now
 * carries that through as MINOR units (paise) on the wire — no Number/100
 * rupee conversion. This test locks that contract so the two web screens
 * (/grants/releases and the disbursement detail, both via formatMoney) stay
 * reconciled: a Rs 1,000 disbursement (100000 paise) must read back as
 * amount === 100000.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { grantApplications } from "../src/modules/application/schema.js";
import { grantBeneficiaries } from "../src/modules/beneficiary/schema.js";
import { grantInstallments, grantDisbursements } from "../src/modules/disbursement/schema.js";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "eeeeeeee-0000-4000-8000-0000000000b1";
const ACTOR = "eeeeeeee-aaaa-4000-8000-0000000000b2";

function token(roles = ["grant_admin"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-rel-unit" }, SECRET);
}

let app: FastifyInstance;
const benId = randomUUID();
const appId = randomUUID();
const instId = randomUUID();
const disbId = randomUUID();

beforeAll(async () => {
  app = await buildApp();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(grantBeneficiaries).values({
      id: benId, tenantId: TENANT, beneficiaryCode: "BEN-REL-01", name: "GP Gamma",
      type: "institution", createdBy: ACTOR, updatedBy: ACTOR,
    } as typeof grantBeneficiaries.$inferInsert);
    await tx.insert(grantApplications).values({
      id: appId, tenantId: TENANT, grantNo: "GNT-REL-UNIT", schemeId: randomUUID(),
      beneficiaryId: benId, purpose: "Release unit test", amountRequestedMinor: 100000n,
      amountApprovedMinor: 100000n, status: "approved", createdBy: ACTOR, updatedBy: ACTOR,
    } as typeof grantApplications.$inferInsert);
    await tx.insert(grantInstallments).values({
      id: instId, tenantId: TENANT, applicationId: appId, installmentNo: 1,
      amountMinor: 100000n, status: "disbursed", createdBy: ACTOR, updatedBy: ACTOR,
    } as typeof grantInstallments.$inferInsert);
    await tx.insert(grantDisbursements).values({
      id: disbId, tenantId: TENANT, installmentId: instId,
      amountMinor: 100000n, // Rs 1,000 in paise
      mode: "PFMS", status: "completed", createdBy: ACTOR, updatedBy: ACTOR,
    } as typeof grantDisbursements.$inferInsert);
  }));
});

afterAll(async () => {
  await app.close();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(grantDisbursements).where(eq(grantDisbursements.tenantId, TENANT));
    await tx.delete(grantInstallments).where(eq(grantInstallments.tenantId, TENANT));
    await tx.delete(grantApplications).where(eq(grantApplications.tenantId, TENANT));
    await tx.delete(grantBeneficiaries).where(eq(grantBeneficiaries.tenantId, TENANT));
  }));
  await sqlClient.end();
});

describe("GET /v1/grants/releases amount unit (GAP-GRANTS-DISBURSEMENTS-DETAIL-02)", () => {
  it("returns amount in PAISE: a 100000-paise disbursement reads back as amount === 100000", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/grants/releases?limit=100",
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const rows = (Array.isArray(body) ? body : body.data) as Array<{ id: string; amount: number }>;
    const row = rows.find((r) => r.id === disbId);
    expect(row).toBeDefined();
    expect(row!.amount).toBe(100000);
  });
});
