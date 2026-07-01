/**
 * R6 — Records Officer + annual review register (Public Records Rules 1997).
 * Verifies: appoint officer (deactivates prior), find active officer, record
 * annual review with decision, list reviews, tenant isolation.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { estabRecordsOfficer, estabAnnualReview } from "../src/modules/records/schema.js";
import {
  upsertRecordsOfficer, findActiveRecordsOfficer,
  insertAnnualReview, listAnnualReviews,
} from "../src/modules/records/repo.js";

const TENANT_A = "a1111111-aaaa-4000-8000-0000000000a1";
const TENANT_B = "a1111111-aaaa-4000-8000-0000000000b2";
const OP1      = "00000000-aaaa-4000-8000-000000000001";
const OP2      = "00000000-aaaa-4000-8000-000000000002";
const FILE_A   = "a1111111-bbbb-4000-8000-0000000000f1";
const ACTOR    = "00000000-aaaa-4000-8000-0000000000c9";

async function clean() {
  for (const t of [TENANT_A, TENANT_B]) {
    await db.delete(estabAnnualReview).where(eq(estabAnnualReview.tenantId, t));
    await db.delete(estabRecordsOfficer).where(eq(estabRecordsOfficer.tenantId, t));
  }
}

beforeEach(clean);
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("R6 Records Officer", () => {
  it("appoints an officer and deactivates the prior one", async () => {
    const id1 = randomUUID();
    await upsertRecordsOfficer(db, { id: id1, tenantId: TENANT_A, operatorId: OP1, active: true, createdBy: ACTOR, updatedBy: ACTOR });
    let active = await findActiveRecordsOfficer(TENANT_A);
    expect(active?.operatorId).toBe(OP1);

    const id2 = randomUUID();
    await upsertRecordsOfficer(db, { id: id2, tenantId: TENANT_A, operatorId: OP2, active: true, createdBy: ACTOR, updatedBy: ACTOR });
    active = await findActiveRecordsOfficer(TENANT_A);
    expect(active?.operatorId).toBe(OP2);
  });

  it("is tenant-scoped (tenant B has no officer)", async () => {
    await upsertRecordsOfficer(db, { id: randomUUID(), tenantId: TENANT_A, operatorId: OP1, active: true, createdBy: ACTOR, updatedBy: ACTOR });
    const fromB = await findActiveRecordsOfficer(TENANT_B);
    expect(fromB).toBeNull();
  });
});

describe("R6 annual review register", () => {
  it("records a retain decision and lists reviews for a file", async () => {
    const id = randomUUID();
    await insertAnnualReview(db, {
      id, tenantId: TENANT_A, fileId: FILE_A, reviewedBy: ACTOR,
      decision: "retain", remarks: "Reviewed, relevant for ongoing audit",
      nextReviewDue: "2028-01-01", createdBy: ACTOR,
    });
    const reviews = await listAnnualReviews(TENANT_A, FILE_A);
    expect(reviews.length).toBe(1);
    expect(reviews[0]?.decision).toBe("retain");
    expect(reviews[0]?.nextReviewDue).toBe("2028-01-01");
  });

  it("is tenant-scoped", async () => {
    await insertAnnualReview(db, {
      id: randomUUID(), tenantId: TENANT_A, fileId: FILE_A, reviewedBy: ACTOR,
      decision: "weed", createdBy: ACTOR,
    });
    const fromB = await listAnnualReviews(TENANT_B, FILE_A);
    expect(fromB).toHaveLength(0);
  });
});
