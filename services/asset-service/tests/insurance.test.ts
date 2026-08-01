/**
 * asset-service insurance module test suite (AST-2)
 *
 * Backend was a facade (POST-only). Added GET list/detail for policies +
 * GET list for claims. These tests verify:
 * - CQRS wiring: POST → queue → consumer → DB persists policy/claim rows
 * - queries.listPolicies / getPolicy / listClaims read back what was written
 * - detail 404 for unknown id
 * - RLS cross-tenant isolation: tenant B cannot read tenant A's policy/claim
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { assetPolicies, assetClaims } from "../src/modules/insurance/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerInsuranceConsumers } from "../src/modules/insurance/consumer.js";
import { COMMANDS } from "../src/topics.js";
import * as queries from "../src/modules/insurance/queries.js";
import * as commands from "../src/modules/insurance/commands.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

// Note: these ids must not collide with other test files' fixture ids — tests
// run across parallel worker processes against the same shared Postgres
// database, so a shared tenantId lets two files race on the same outbox rows.
// "…0000ac<nn>" is unique to this file (grepped against tests/ before picking).
const ACTOR    = "00000000-aaaa-4000-8000-0000ac000001";
const TENANT_A = "11111111-aaaa-4000-8000-0000ac000001";
const TENANT_B = "99999999-bbbb-4000-8000-0000ac000002";
const ASSET_1  = "22222222-bbbb-4000-8000-0000ac000001";
const POLICY_1 = "33333333-cccc-4000-8000-0000ac000001";
const CLAIM_1  = "44444444-dddd-4000-8000-0000ac000001";
const MSG_POLICY = "55555555-eeee-4000-8000-0000ac000001";
const MSG_CLAIM  = "66666666-ffff-4000-8000-0000ac000001";
const POLICY_2 = "77777777-cccc-4000-8000-0000ac000002";
const MSG_POLICY_2 = "88888888-eeee-4000-8000-0000ac000002";
const POLICY_3 = "aaaaaaaa-cccc-4000-8000-0000ac000003";
const MSG_POLICY_3 = "bbbbbbbb-eeee-4000-8000-0000ac000003";
const CLAIM_SEED = "cccccccc-dddd-4000-8000-0000ac000003";
const MSG_CLAIM_SEED = "dddddddd-ffff-4000-8000-0000ac000003";

function tokenForTenant(tenantId: string, actorId: string, roles: string[] = ["asset_manager"]) {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-insurance" }, SECRET, 3600);
}

let ctxCounter = 0;
function ctxFor(tenantId: string, actorId: string): {
  tenantId: string; actorId: string; actorType: "user"; roles: string[]; correlationId: string;
} {
  ctxCounter += 1;
  return { tenantId, actorId, actorType: "user", roles: ["asset_manager"], correlationId: `corr-cumulative-${ctxCounter}` };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// #146: asset_svc role is NOBYPASSRLS + FORCE RLS — raw test reads/cleanup
// must run inside a tenant-GUC transaction (mirrors asset.test.ts's asTenant).
function asTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runWithTenant(tenantId, () => db.transaction(fn)) as Promise<T>;
}

async function wipe() {
  for (const tenantId of [TENANT_A, TENANT_B]) {
    await asTenant(tenantId, async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, tenantId));
      await tx.delete(assetClaims).where(eq(assetClaims.id, CLAIM_1));
      await tx.delete(assetClaims).where(eq(assetClaims.id, CLAIM_SEED));
      await tx.delete(assetPolicies).where(eq(assetPolicies.id, POLICY_1));
      await tx.delete(assetPolicies).where(eq(assetPolicies.id, POLICY_2));
      await tx.delete(assetPolicies).where(eq(assetPolicies.id, POLICY_3));
      await tx.delete(processed).where(eq(processed.messageId, MSG_POLICY));
      await tx.delete(processed).where(eq(processed.messageId, MSG_CLAIM));
      await tx.delete(processed).where(eq(processed.messageId, MSG_POLICY_2));
      await tx.delete(processed).where(eq(processed.messageId, MSG_POLICY_3));
      await tx.delete(processed).where(eq(processed.messageId, MSG_CLAIM_SEED));
    });
  }
}

// sqlClient is closed once, at the very end of the file (see final afterAll) —
// NOT per-describe, since the HTTP-level describes below still need the pool.
afterAll(async () => {
  await sqlClient.end();
});

describe("Insurance consumer — CQRS wiring + reads (integration)", () => {
  beforeAll(wipe);
  afterAll(wipe);

  it("policy.create: publishes → consumer persists → queries.listPolicies / getPolicy read it back", async () => {
    const q = new MemoryQueue();
    registerInsuranceConsumers(q);
    await q.start();

    await q.publish(COMMANDS.insurancePolicyCreate, {
      messageId: MSG_POLICY, type: COMMANDS.insurancePolicyCreate,
      tenantId: TENANT_A, actorId: ACTOR, correlationId: "corr-policy-1", schemaVersion: "1.0",
      payload: {
        id: POLICY_1, tenantId: TENANT_A, assetId: ASSET_1,
        policyNo: "POL-2026-001", insurer: "National Insurance Co",
        coverageMinor: 50000000, premiumMinor: 1250000, currency: "INR",
        startDate: "2026-04-01", endDate: "2027-03-31", renewalReminderDays: 30,
      },
    });
    await new Promise<void>((r) => setTimeout(r, 400));
    await q.stop();

    // queries.* go through scopedRead(), which relies on the tenant GUC set
    // via AsyncLocalStorage (createTenantTxHook at the HTTP layer). Outside a
    // request we reproduce that context with runWithTenant, same as asTenant().
    const list = await runWithTenant(TENANT_A, () => queries.listPolicies(TENANT_A, { assetId: ASSET_1 }));
    expect(list).toHaveLength(1);
    expect(list[0]?.policyNo).toBe("POL-2026-001");
    expect(list[0]?.coverageMinor).toBe(50000000n);
    expect(list[0]?.premiumMinor).toBe(1250000n);
    expect(list[0]?.status).toBe("active");

    const detail = await runWithTenant(TENANT_A, () => queries.getPolicy(TENANT_A, POLICY_1));
    expect(detail?.id).toBe(POLICY_1);
    expect(detail?.insurer).toBe("National Insurance Co");

    const seen = await asTenant(TENANT_A, (tx) => tx.select().from(processed).where(eq(processed.messageId, MSG_POLICY)));
    expect(seen).toHaveLength(1);
    const outbox = await asTenant(TENANT_A, (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT_A)));
    expect(outbox.map((r) => r.eventType)).toContain("audit.event.record");
  });

  it("getPolicy returns null for an unknown id (404 mapping at route layer)", async () => {
    const detail = await runWithTenant(TENANT_A, () => queries.getPolicy(TENANT_A, "00000000-0000-4000-8000-000000000000"));
    expect(detail).toBeNull();
  });

  it("RLS cross-tenant: Tenant B cannot list or read Tenant A's policy", async () => {
    const listB = await runWithTenant(TENANT_B, () => queries.listPolicies(TENANT_B, { assetId: ASSET_1 }));
    expect(listB).toHaveLength(0);

    const detailB = await runWithTenant(TENANT_B, () => queries.getPolicy(TENANT_B, POLICY_1));
    expect(detailB).toBeNull();
  });

  it("claim.create: publishes → consumer persists → queries.listClaims reads it back, scoped to policy", async () => {
    const q = new MemoryQueue();
    registerInsuranceConsumers(q);
    await q.start();

    await q.publish(COMMANDS.insuranceClaimCreate, {
      messageId: MSG_CLAIM, type: COMMANDS.insuranceClaimCreate,
      tenantId: TENANT_A, actorId: ACTOR, correlationId: "corr-claim-1", schemaVersion: "1.0",
      payload: {
        id: CLAIM_1, tenantId: TENANT_A, policyId: POLICY_1, assetId: ASSET_1,
        claimDate: "2026-06-15", claimAmountMinor: 800000, currency: "INR",
        notes: "Fire damage to server room AC unit",
      },
    });
    await new Promise<void>((r) => setTimeout(r, 400));
    await q.stop();

    const list = await runWithTenant(TENANT_A, () => queries.listClaims(TENANT_A, { policyId: POLICY_1 }));
    expect(list).toHaveLength(1);
    expect(list[0]?.claimAmountMinor).toBe(800000n);
    expect(list[0]?.status).toBe("pending");

    const detail = await runWithTenant(TENANT_A, () => queries.getClaim(TENANT_A, CLAIM_1));
    expect(detail?.notes).toBe("Fire damage to server room AC unit");
  });

  it("RLS cross-tenant: Tenant B cannot list or read Tenant A's claim", async () => {
    const listB = await runWithTenant(TENANT_B, () => queries.listClaims(TENANT_B, { policyId: POLICY_1 }));
    expect(listB).toHaveLength(0);

    const detailB = await runWithTenant(TENANT_B, () => queries.getClaim(TENANT_B, CLAIM_1));
    expect(detailB).toBeNull();
  });
});

// ── Money-safety: claim amount must not exceed the policy's sum insured ──

describe("Insurance — claim-vs-coverage enforcement (integration, HTTP)", () => {
  beforeAll(async () => {
    const q = new MemoryQueue();
    registerInsuranceConsumers(q);
    await q.start();
    await q.publish(COMMANDS.insurancePolicyCreate, {
      messageId: MSG_POLICY_2, type: COMMANDS.insurancePolicyCreate,
      tenantId: TENANT_A, actorId: ACTOR, correlationId: "corr-policy-2", schemaVersion: "1.0",
      payload: {
        id: POLICY_2, tenantId: TENANT_A, assetId: ASSET_1,
        policyNo: "POL-2026-002", insurer: "United India Insurance",
        coverageMinor: 1000000, premiumMinor: 50000, currency: "INR",
        startDate: "2026-04-01", endDate: "2027-03-31", renewalReminderDays: 30,
      },
    });
    await new Promise<void>((r) => setTimeout(r, 400));
    await q.stop();
  });
  afterAll(async () => {
    await asTenant(TENANT_A, async (tx) => {
      await tx.delete(assetPolicies).where(eq(assetPolicies.id, POLICY_2));
      await tx.delete(processed).where(eq(processed.messageId, MSG_POLICY_2));
    });
  });

  it("POST /v1/assets/insurance/claims rejects an amount above the sum insured (400 CLAIM_EXCEEDS_COVERAGE)", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const token = tokenForTenant(TENANT_A, ACTOR);
    const res = await app.inject({
      method: "POST",
      url: "/v1/assets/insurance/claims",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: {
        policyId: POLICY_2, assetId: ASSET_1,
        claimDate: "2026-06-15", claimAmountMinor: 1000001, currency: "INR",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("CLAIM_EXCEEDS_COVERAGE");
    await app.close();
  });

  it("POST /v1/assets/insurance/claims accepts an amount within the sum insured (202)", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const token = tokenForTenant(TENANT_A, ACTOR);
    const res = await app.inject({
      method: "POST",
      url: "/v1/assets/insurance/claims",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: {
        policyId: POLICY_2, assetId: ASSET_1,
        claimDate: "2026-06-15", claimAmountMinor: 1000000, currency: "INR",
      },
    });
    expect(res.statusCode).toBe(202);
    await app.close();
  });

  it("POST /v1/assets/insurance/claims against an unknown policy → 404 POLICY_NOT_FOUND", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const token = tokenForTenant(TENANT_A, ACTOR);
    const res = await app.inject({
      method: "POST",
      url: "/v1/assets/insurance/claims",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: {
        policyId: "00000000-0000-4000-8000-000000000000", assetId: ASSET_1,
        claimDate: "2026-06-15", claimAmountMinor: 100, currency: "INR",
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("POLICY_NOT_FOUND");
    await app.close();
  });
});

// ── Money-safety: CUMULATIVE claims across a policy must not exceed cover ─
//
// commands.ts previously compared only the single incoming claim against
// policy.coverageMinor, so a 10,000 policy would accept a 9,000 claim
// followed by another 9,000 claim (18,000 total against 10,000 cover).
// createClaim now sums every non-rejected claim already on the policy via
// queries.sumClaimsByPolicy and rejects when existingTotal + newAmount would
// exceed coverage.

describe("Insurance — cumulative claim aggregation across multiple claims", () => {
  beforeAll(async () => {
    const q = new MemoryQueue();
    registerInsuranceConsumers(q);
    await q.start();

    // POLICY_3: sum insured 1,000,000 minor units.
    await q.publish(COMMANDS.insurancePolicyCreate, {
      messageId: MSG_POLICY_3, type: COMMANDS.insurancePolicyCreate,
      tenantId: TENANT_A, actorId: ACTOR, correlationId: "corr-policy-3", schemaVersion: "1.0",
      payload: {
        id: POLICY_3, tenantId: TENANT_A, assetId: ASSET_1,
        policyNo: "POL-2026-003", insurer: "Oriental Insurance Co",
        coverageMinor: 1000000, premiumMinor: 40000, currency: "INR",
        startDate: "2026-04-01", endDate: "2027-03-31", renewalReminderDays: 30,
      },
    });
    // Seed one already-settled/pending claim of 700,000 against POLICY_3 so
    // the running total starts above zero, the way a real policy would after
    // its first claim.
    await q.publish(COMMANDS.insuranceClaimCreate, {
      messageId: MSG_CLAIM_SEED, type: COMMANDS.insuranceClaimCreate,
      tenantId: TENANT_A, actorId: ACTOR, correlationId: "corr-claim-seed", schemaVersion: "1.0",
      payload: {
        id: CLAIM_SEED, tenantId: TENANT_A, policyId: POLICY_3, assetId: ASSET_1,
        claimDate: "2026-05-01", claimAmountMinor: 700000, currency: "INR",
        notes: "First claim — water damage",
      },
    });
    await new Promise<void>((r) => setTimeout(r, 400));
    await q.stop();
  });
  afterAll(async () => {
    await asTenant(TENANT_A, async (tx) => {
      await tx.delete(assetClaims).where(eq(assetClaims.id, CLAIM_SEED));
      await tx.delete(assetPolicies).where(eq(assetPolicies.id, POLICY_3));
      await tx.delete(processed).where(eq(processed.messageId, MSG_POLICY_3));
      await tx.delete(processed).where(eq(processed.messageId, MSG_CLAIM_SEED));
    });
  });

  it("sumClaimsByPolicy reflects the seeded 700,000 claim", async () => {
    const total = await runWithTenant(TENANT_A, () => queries.sumClaimsByPolicy(TENANT_A, POLICY_3));
    expect(total).toBe(700000n);
  });

  it("rejects a second claim that would push the CUMULATIVE total over the sum insured (700,000 + 400,000 > 1,000,000)", async () => {
    const ctx = ctxFor(TENANT_A, ACTOR);
    await expect(
      runWithTenant(TENANT_A, () =>
        commands.createClaim(ctx, {
          policyId: POLICY_3, assetId: ASSET_1,
          claimDate: "2026-06-15", claimAmountMinor: 400000, currency: "INR",
        }),
      ),
    ).rejects.toMatchObject({ status: 400, code: "CLAIM_EXCEEDS_COVERAGE" });

    // The single-claim amount (400,000) is well within the policy's total
    // sum insured (1,000,000) — this only fails because of the prior
    // 700,000 claim. Confirms the check is cumulative, not per-claim.
    expect(400000).toBeLessThan(1000000);
  });

  it("the rejection error message states the remaining balance, not just a generic failure", async () => {
    const ctx = ctxFor(TENANT_A, ACTOR);
    await expect(
      runWithTenant(TENANT_A, () =>
        commands.createClaim(ctx, {
          policyId: POLICY_3, assetId: ASSET_1,
          claimDate: "2026-06-15", claimAmountMinor: 400000, currency: "INR",
        }),
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining("remaining: 300000") });
  });

  it("accepts a second claim that keeps the CUMULATIVE total within the sum insured (700,000 + 300,000 = 1,000,000)", async () => {
    const ctx = ctxFor(TENANT_A, ACTOR);
    const result = await runWithTenant(TENANT_A, () =>
      commands.createClaim(ctx, {
        policyId: POLICY_3, assetId: ASSET_1,
        claimDate: "2026-06-15", claimAmountMinor: 300000, currency: "INR",
      }),
    );
    expect(result.status).toBe("accepted");
    expect(result.id).toBeDefined();
  });
});

// ── HTTP route auth guard (inject) ────────────────────────────────────────

describe("insurance route auth (inject)", () => {
  it("GET /v1/assets/insurance/policies without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/assets/insurance/policies" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("GET /v1/assets/insurance/claims without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/assets/insurance/claims" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("GET /v1/assets/insurance/policies/:id without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/assets/insurance/policies/00000000-0000-4000-8000-000000000001" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
