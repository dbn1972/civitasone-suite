/**
 * GAP-GRANTS-APPLICATIONS-01 / HOME-02: the /v1/grants/applications list must
 * surface the real application-stage status (e.g. "submitted"/"under_review"),
 * NOT the collapsed sanctioned-grant status, and each row's id must be the same
 * id the /v1/grants/applications/:id detail route reads (so a row never 404s).
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { grantApplications } from "../src/modules/application/schema.js";
import { grantBeneficiaries } from "../src/modules/beneficiary/schema.js";
import { grantScores } from "../src/modules/application/schema.js";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "dddddddd-0000-4000-8000-0000000000a1";
const ACTOR = "dddddddd-aaaa-4000-8000-0000000000a2";

function token(roles = ["grant_admin"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-app-list" }, SECRET);
}

let app: FastifyInstance;
const benId = randomUUID();
const submittedId = randomUUID();

beforeAll(async () => {
  app = await buildApp();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(grantBeneficiaries).values({
      id: benId, tenantId: TENANT, beneficiaryCode: "BEN-APL-01", name: "GP Alpha",
      type: "institution", createdBy: ACTOR, updatedBy: ACTOR,
    } as typeof grantBeneficiaries.$inferInsert);
    await tx.insert(grantApplications).values({
      id: submittedId, tenantId: TENANT, grantNo: "GNT-APL-SUBMITTED", schemeId: randomUUID(),
      beneficiaryId: benId, purpose: "Submitted application under review",
      amountRequestedMinor: 4500000n, amountApprovedMinor: 0n, status: "submitted",
      submittedAt: new Date(), createdBy: ACTOR, updatedBy: ACTOR,
    } as typeof grantApplications.$inferInsert);
    await tx.insert(grantScores).values({
      id: randomUUID(), tenantId: TENANT, applicationId: submittedId,
      reviewerRef: "identity_user:rev-9", technicalScore: "82", financialScore: "70",
      totalScore: "76", recommendation: "Recommended with conditions",
      createdBy: ACTOR, updatedBy: ACTOR,
    } as typeof grantScores.$inferInsert);
  }));
});

afterAll(async () => {
  await app.close();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(grantScores).where(eq(grantScores.tenantId, TENANT));
    await tx.delete(grantApplications).where(eq(grantApplications.tenantId, TENANT));
    await tx.delete(grantBeneficiaries).where(eq(grantBeneficiaries.tenantId, TENANT));
  }));
  await sqlClient.end();
});

describe("GET /v1/grants/applications (application-stage statuses)", () => {
  it("returns a submitted application with status 'submitted', not collapsed to 'active'", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/grants/applications?limit=50",
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ id: string; status: string; grantNo: string }>;
    const row = rows.find((r) => r.id === submittedId);
    expect(row).toBeDefined();
    expect(row!.status).toBe("submitted");
  });

  it("the list row id resolves on the detail route (no 404)", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/grants/applications/${submittedId}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("submitted");
  });

  // GAP-GRANTS-APPLICATIONS-DETAIL-05: the detail route surfaces the latest score.
  it("surfaces the latest evaluation (technical/financial score + recommendation)", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/grants/applications/${submittedId}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.technicalScore).toBe(82);
    expect(body.financialScore).toBe(70);
    expect(body.recommendation).toBe("Recommended with conditions");
    expect(body.scoredReviewerRef).toBe("identity_user:rev-9");
  });
});
