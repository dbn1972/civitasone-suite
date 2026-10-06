/**
 * GAP-GRANTS-INSTALLMENTS-03 + GAP-GRANTS-GRANTEES-04 (batch2):
 *  - isSchemeReleasable: a release must fail closed while the funding scheme
 *    is suspended or closed (pure domain guard, DB-independent), and
 *  - getGranteeDetail: the single-grantee detail query returns the wire shape.
 *
 * NOTE: the end-to-end disbursement-consumer path is covered by flows.test.ts,
 * which has a PRE-EXISTING environment failure in this worktree's test DB
 * ("UNDEFINED_VALUE: Undefined values are not allowed" on every
 * grant.disbursement.initiate flow, independent of this change — the stock
 * over-budget-reject test fails the same way). The INSTALLMENTS-03 scheme guard
 * is therefore verified through its pure decision function here; the consumer
 * calls that same function on the scheme row's status.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { grantBeneficiaries } from "../src/modules/beneficiary/schema.js";
import { getGranteeDetail } from "../src/modules/beneficiary/queries.js";
import { isSchemeReleasable } from "../src/modules/disbursement/domain.js";
import { randomUUID } from "node:crypto";

const ACTOR = "20000000-aaaa-4000-8000-000000000001";
const TENANT = "2a000000-aaaa-4000-8000-000000000099";
const BEN = "2a000000-cccc-4000-8000-000000000099";

async function wipe() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(grantBeneficiaries).where(eq(grantBeneficiaries.tenantId, TENANT));
  }));
}

async function seedBeneficiary() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(grantBeneficiaries).values({
      id: BEN, tenantId: TENANT, name: "Nashik Society", type: "society",
      category: "ngo", geography: "Nashik", status: "active",
      incomeAnnualMinor: 50000000n, createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
}

beforeEach(wipe);
afterAll(async () => { await wipe(); await sqlClient.end(); });

describe("GAP-GRANTS-INSTALLMENTS-03 — scheme release guard (pure)", () => {
  it("blocks a release while the scheme is suspended or closed", () => {
    expect(isSchemeReleasable("suspended")).toBe(false);
    expect(isSchemeReleasable("closed")).toBe(false);
  });

  it("allows a release while the scheme is active/draft/other", () => {
    expect(isSchemeReleasable("active")).toBe(true);
    expect(isSchemeReleasable("draft")).toBe(true);
    expect(isSchemeReleasable(null)).toBe(true); // unknown → defer to other gates
    expect(isSchemeReleasable(undefined)).toBe(true);
  });
});

describe("GAP-GRANTS-GRANTEES-04 — grantee detail query", () => {
  it("returns the single-grantee detail shape", async () => {
    await seedBeneficiary();
    const detail = await getGranteeDetail(TENANT, BEN);
    expect(detail).not.toBeNull();
    expect(detail?.id).toBe(BEN);
    expect(detail?.name).toBe("Nashik Society");
    expect(detail?.type).toBe("society");
    expect(detail?.geography).toBe("Nashik");
    expect(detail?.incomeAnnualMinor).toBe("50000000");
    // PII identifiers are null until the registry carries them (masked at UI).
    expect(detail?.registrationNo).toBeNull();
  });

  it("returns null for an unknown grantee", async () => {
    const detail = await getGranteeDetail(TENANT, randomUUID());
    expect(detail).toBeNull();
  });
});
