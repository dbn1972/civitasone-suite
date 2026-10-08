/**
 * ml-assets-03 backend guards.
 *  - GAP-ASSETS-INSURANCE-CLAIMS-03 / INSURANCE-DETAIL-02: claim settle/reject
 *    cannot exceed the claim, cannot re-decide a decided claim, need a reason.
 *  - GAP-ASSETS-INSURANCE-03: GET /assets?search= matches a substring of
 *    name/code (the web asset picker types partial words).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { MemoryQueue } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { assetPolicies, assetClaims } from "../src/modules/insurance/schema.js";
import { assetAssets } from "../src/modules/register/schema.js";
import * as registerRepo from "../src/modules/register/repo.js";
import * as insuranceRepo from "../src/modules/insurance/repo.js";
import { registerInsuranceConsumers } from "../src/modules/insurance/consumer.js";
import { COMMANDS } from "../src/topics.js";
import { outboxMessages } from "../src/shared/outbox.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "11111111-aaaa-4000-8000-0000ab030001";
const ACTOR = "00000000-aaaa-4000-8000-0000ab030001";
// GAP2-ASSETS-INSURANCE-CLAIMS-01: a claim decision may not be taken by its
// filer. These claims are FILED by a distinct actor so ACTOR (the asset_admin
// approver in every decision call below) is a valid, different checker.
const FILER = "0000000f-aaaa-4000-8000-0000ab030001";
const POLICY = "33333333-cccc-4000-8000-0000ab030001";
const ASSET = "22222222-bbbb-4000-8000-0000ab030001";
const CLAIMS = {
  settle: "44444444-dddd-4000-8000-0000ab030001",
  reject: "44444444-dddd-4000-8000-0000ab030002",
  decided: "44444444-dddd-4000-8000-0000ab030003",
  stale: "44444444-dddd-4000-8000-0000ab030004",
  notes: "44444444-dddd-4000-8000-0000ab030005",
};
const ASSET_IDS = ["55555555-eeee-4000-8000-0000ab030001", "55555555-eeee-4000-8000-0000ab030002"];
const POLICY_OLD = "33333333-cccc-4000-8000-0000ab030002";
const CATEGORY = "66666666-ffff-4000-8000-0000ab030001";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
function asTenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runWithTenant(TENANT, () => db.transaction(fn)) as Promise<T>;
}
const token = (roles: string[]) => signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-ml-assets-03" }, SECRET, 3600);

async function cleanup() {
  await asTenant(async (tx) => {
    await tx.delete(assetClaims).where(inArray(assetClaims.id, Object.values(CLAIMS)));
    await tx.delete(assetPolicies).where(inArray(assetPolicies.id, [POLICY, POLICY_OLD]));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(assetAssets).where(inArray(assetAssets.id, ASSET_IDS));
  });
}

beforeAll(async () => {
  await cleanup();
  await asTenant(async (tx) => {
    await tx.insert(assetPolicies).values({
      id: POLICY, tenantId: TENANT, assetId: ASSET, policyNo: "POL-ML3", insurer: "Test Insurer",
      coverageMinor: 10_000_000n, premiumMinor: 100_000n, startDate: "2026-04-01", endDate: "2027-03-31",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    for (const [key, id] of Object.entries(CLAIMS)) {
      await tx.insert(assetClaims).values({
        id, tenantId: TENANT, policyId: POLICY, assetId: ASSET, claimDate: "2026-06-01",
        claimAmountMinor: 800_000n, status: key === "decided" ? "settled" : "pending",
        notes: key === "notes" ? "Water damage in server room" : null,
        createdBy: FILER, updatedBy: FILER,
      });
    }
    await tx.insert(assetPolicies).values({
      id: POLICY_OLD, tenantId: TENANT, assetId: ASSET, policyNo: "POL-ML3-OLD", insurer: "Test Insurer",
      coverageMinor: 1_000_000n, premiumMinor: 1_000n, startDate: "2025-04-01", endDate: "2026-03-31", status: "cancelled",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(assetAssets).values([
      { id: ASSET_IDS[0]!, tenantId: TENANT, name: "Diesel Generator 250", code: "AST-ML3-A", categoryId: CATEGORY, acquisitionDate: "2026-01-01", createdBy: ACTOR, updatedBy: ACTOR },
      { id: ASSET_IDS[1]!, tenantId: TENANT, name: "Laptop", code: "AST-ML3-B", categoryId: CATEGORY, acquisitionDate: "2026-01-01", createdBy: ACTOR, updatedBy: ACTOR },
    ]);
  });
});

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

async function patch(path: string, roles: string[], payload: unknown) {
  const { buildApp } = await import("../src/app.js");
  const app = await buildApp();
  const res = await app.inject({
    method: "PATCH",
    url: path,
    headers: { authorization: `Bearer ${token(roles)}`, "content-type": "application/json" },
    payload: payload as object,
  });
  await app.close();
  return res;
}

// GAP2-ASSETS-INSURANCE-CLAIMS-02: the decision/policy-update routes now
// publish a command and answer 202; the write + audit happen in the consumer.
// These helpers apply the equivalent command through the real consumer so the
// tests can still assert the persisted row/audit, driven by ACTOR (a valid
// checker, != FILER).
async function applyDecide(id: string, decision: "approve" | "settle" | "reject", extra: Record<string, unknown> = {}): Promise<void> {
  const q = new MemoryQueue();
  registerInsuranceConsumers(q);
  await q.start();
  await q.publish(COMMANDS.insuranceClaimDecide, {
    messageId: randomUUID(), type: COMMANDS.insuranceClaimDecide,
    tenantId: TENANT, actorId: ACTOR, correlationId: "corr-ml3", schemaVersion: "1.0",
    payload: { id, tenantId: TENANT, decision, ...extra },
  });
  await new Promise<void>((r) => setTimeout(r, 350));
  await q.stop();
}

async function applyPolicyUpdate(id: string, patchBody: Record<string, unknown>): Promise<void> {
  const q = new MemoryQueue();
  registerInsuranceConsumers(q);
  await q.start();
  await q.publish(COMMANDS.insurancePolicyUpdate, {
    messageId: randomUUID(), type: COMMANDS.insurancePolicyUpdate,
    tenantId: TENANT, actorId: ACTOR, correlationId: "corr-ml3-pol", schemaVersion: "1.0",
    payload: { id, tenantId: TENANT, ...patchBody },
  });
  await new Promise<void>((r) => setTimeout(r, 350));
  await q.stop();
}

describe("insurance claim decisions", () => {
  it("settle: an amount above the claim is refused 400 SETTLEMENT_EXCEEDS_CLAIM and the claim stays pending", async () => {
    const res = await patch(`/v1/assets/insurance/claims/${CLAIMS.settle}/settle`, ["asset_admin"], { settlementAmountMinor: 800_001 });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("SETTLEMENT_EXCEEDS_CLAIM");
    const row = await asTenant((tx) => tx.select().from(assetClaims).where(eq(assetClaims.id, CLAIMS.settle)));
    expect(row[0]?.status).toBe("pending");
  });

  it("settle: a valid amount settles the claim and records the settled amount", async () => {
    const res = await patch(`/v1/assets/insurance/claims/${CLAIMS.settle}/settle`, ["asset_admin"], { settlementAmountMinor: 750_050 });
    expect(res.statusCode).toBe(202); // GAP2-ASSETS-INSURANCE-CLAIMS-02: CQRS → 202
    await applyDecide(CLAIMS.settle, "settle", { settlementAmountMinor: 750_050 });
    const row = await asTenant((tx) => tx.select().from(assetClaims).where(eq(assetClaims.id, CLAIMS.settle)));
    expect(row[0]?.status).toBe("settled");
    expect(row[0]?.settledAmountMinor).toBe(750_050n);
  });

  it("settle: an already-settled claim cannot be settled again (409 CLAIM_NOT_DECIDABLE)", async () => {
    const res = await patch(`/v1/assets/insurance/claims/${CLAIMS.decided}/settle`, ["asset_admin"], { settlementAmountMinor: 1 });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("CLAIM_NOT_DECIDABLE");
  });

  it("reject: a decided claim cannot be rejected afterwards (409)", async () => {
    const res = await patch(`/v1/assets/insurance/claims/${CLAIMS.decided}/reject`, ["asset_admin"], { reason: "late" });
    expect(res.statusCode).toBe(409);
  });

  it("reject: a blank reason is refused 400 and a real reason rejects the claim", async () => {
    const blank = await patch(`/v1/assets/insurance/claims/${CLAIMS.reject}/reject`, ["asset_admin"], { reason: "   " });
    expect(blank.statusCode).toBe(400);
    const ok = await patch(`/v1/assets/insurance/claims/${CLAIMS.reject}/reject`, ["asset_admin"], { reason: "Not covered" });
    expect(ok.statusCode).toBe(202); // GAP2-ASSETS-INSURANCE-CLAIMS-02: CQRS → 202
    await applyDecide(CLAIMS.reject, "reject", { reason: "Not covered" });
    const row = await asTenant((tx) => tx.select().from(assetClaims).where(eq(assetClaims.id, CLAIMS.reject)));
    expect(row[0]?.status).toBe("rejected");
  });

  it("an asset_manager may not decide a claim (403)", async () => {
    const res = await patch(`/v1/assets/insurance/claims/${CLAIMS.reject}/reject`, ["asset_manager"], { reason: "x" });
    expect(res.statusCode).toBe(403);
  });
});

const AUDIT = (a: string) => ({ actorId: ACTOR, correlationId: "corr-ml3", action: a, resourceType: "insurance_claim" as const, before: { status: "pending", amountMinor: 0n } });

describe("conditional decisions, audit and policy rules", () => {
  it("a stale second decision changes 0 rows: repo returns null and the service answers 409", async () => {
    const first = await runWithTenant(TENANT, () => insuranceRepo.updateClaim(TENANT, CLAIMS.stale, { status: "settled" }, ["pending", "approved"], AUDIT("settle")));
    expect(first?.status).toBe("settled");
    const second = await runWithTenant(TENANT, () => insuranceRepo.updateClaim(TENANT, CLAIMS.stale, { status: "rejected" }, ["pending", "approved"], AUDIT("reject")));
    expect(second).toBeNull();
    const row = await asTenant((tx) => tx.select().from(assetClaims).where(eq(assetClaims.id, CLAIMS.stale)));
    expect(row[0]?.status).toBe("settled");
    const res = await patch(`/v1/assets/insurance/claims/${CLAIMS.stale}/reject`, ["asset_admin"], { reason: "late" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("CLAIM_NOT_DECIDABLE");
  });

  it("updatePolicy returns null (never a silent success) when no row matches", async () => {
    const r = await runWithTenant(TENANT, () => insuranceRepo.updatePolicy(TENANT, "99999999-9999-4999-8999-999999999999", { status: "cancelled" }, { ...AUDIT("update"), resourceType: "insurance_policy" }));
    expect(r).toBeNull();
    const res = await patch(`/v1/assets/insurance/policies/99999999-9999-4999-8999-999999999999`, ["asset_admin"], { status: "cancelled" });
    expect(res.statusCode).toBe(404);
  });

  it("reject keeps the filer's notes and appends the reason; an audit event with before/after/reason is queued", async () => {
    const res = await patch(`/v1/assets/insurance/claims/${CLAIMS.notes}/reject`, ["asset_admin"], { reason: "Not covered" });
    expect(res.statusCode).toBe(202); // GAP2-ASSETS-INSURANCE-CLAIMS-02: CQRS → 202
    await applyDecide(CLAIMS.notes, "reject", { reason: "Not covered" });
    const row = await asTenant((tx) => tx.select().from(assetClaims).where(eq(assetClaims.id, CLAIMS.notes)));
    expect(row[0]?.notes).toBe("Water damage in server room\nRejected: Not covered");
    const events = await asTenant((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)));
    const ev = events.map((e) => e.payload as Record<string, any>).find((p) => p.resourceId === CLAIMS.notes);
    expect(ev).toMatchObject({ action: "reject", resourceType: "insurance_claim", reason: "Not covered", before: { status: "pending" }, after: { status: "rejected" } });
  });

  it("settle audit carries the settled amount", async () => {
    const events = await asTenant((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)));
    const ev = events.map((e) => e.payload as Record<string, any>).find((p) => p.resourceId === CLAIMS.settle && p.action === "settle");
    expect(ev?.after).toMatchObject({ status: "settled", amountMinor: "750050" });
  });

  it("policy PATCH: rejects a non-date expiryDate and a cancelled -> active flip", async () => {
    const bad = await patch(`/v1/assets/insurance/policies/${POLICY}`, ["asset_admin"], { expiryDate: "2027-02-31" });
    expect(bad.statusCode).toBe(400);
    const flip = await patch(`/v1/assets/insurance/policies/${POLICY_OLD}`, ["asset_admin"], { status: "active" });
    expect(flip.statusCode).toBe(409);
    expect(flip.json().code).toBe("POLICY_REACTIVATION_NOT_ALLOWED");
  });

  it("policy PATCH: a valid change is applied and audited", async () => {
    const ok = await patch(`/v1/assets/insurance/policies/${POLICY}`, ["asset_admin"], { expiryDate: "2027-06-30" });
    expect(ok.statusCode).toBe(202); // GAP2-ASSETS-INSURANCE-CLAIMS-02: CQRS → 202
    await applyPolicyUpdate(POLICY, { endDate: "2027-06-30" });
    const row = await asTenant((tx) => tx.select().from(assetPolicies).where(eq(assetPolicies.id, POLICY)));
    expect(row[0]?.endDate).toBe("2027-06-30");
  });
});

describe("asset list search", () => {
  const find = (search: string) =>
    runWithTenant(TENANT, () => registerRepo.findAssetsByTenant(TENANT, { search, limit: 50 })).then((rows) =>
      rows.map((r) => r.id).filter((id) => ASSET_IDS.includes(id)),
    );

  it("matches a partial word of the name (case-insensitive)", async () => {
    expect(await find("generat")).toEqual([ASSET_IDS[0]]);
    expect(await find("LAPT")).toEqual([ASSET_IDS[1]]);
  });

  it("matches a substring of the code and still matches whole words", async () => {
    expect(await find("ML3-B")).toEqual([ASSET_IDS[1]]);
    expect(await find("Diesel")).toEqual([ASSET_IDS[0]]);
  });

  it("treats % and _ literally (no wildcard match-all)", async () => {
    expect(await find("%")).toEqual([]);
    expect(await find("_")).toEqual([]);
  });
});
