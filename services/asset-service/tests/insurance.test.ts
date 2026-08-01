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
import { db, sqlClient } from "../src/shared/db.js";
import { assetPolicies, assetClaims } from "../src/modules/insurance/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerInsuranceConsumers } from "../src/modules/insurance/consumer.js";
import { COMMANDS } from "../src/topics.js";
import * as queries from "../src/modules/insurance/queries.js";

const ACTOR    = "00000000-aaaa-4000-8000-000000000009";
const TENANT_A = "11111111-aaaa-4000-8000-000000000009";
const TENANT_B = "99999999-bbbb-4000-8000-000000000009";
const ASSET_1  = "22222222-bbbb-4000-8000-000000000009";
const POLICY_1 = "33333333-cccc-4000-8000-000000000009";
const CLAIM_1  = "44444444-dddd-4000-8000-000000000009";
const MSG_POLICY = "55555555-eeee-4000-8000-000000000009";
const MSG_CLAIM  = "66666666-ffff-4000-8000-000000000009";

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
      await tx.delete(assetPolicies).where(eq(assetPolicies.id, POLICY_1));
      await tx.delete(processed).where(eq(processed.messageId, MSG_POLICY));
      await tx.delete(processed).where(eq(processed.messageId, MSG_CLAIM));
    });
  }
}

describe("Insurance consumer — CQRS wiring + reads (integration)", () => {
  beforeAll(wipe);
  afterAll(async () => {
    await wipe();
    await sqlClient.end();
  });

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
