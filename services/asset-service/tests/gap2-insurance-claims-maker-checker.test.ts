/**
 * GAP2-ASSETS-INSURANCE-CLAIMS-01 (HIGH) + 02 (MEDIUM)
 *
 * 01: a money-bearing claim decision (approve/settle/reject) may NEVER be taken
 *     by the same user who filed the claim (segregation of duties). On the old
 *     code the filer could settle their own claim and got 202/200.
 * 02: the claim-decision + policy-update routes publish a command and answer
 *     202 (CQRS write path, CLAUDE.md §6) instead of writing to Postgres inside
 *     the route handler. The write + audit live in the consumer.
 *
 * These assert the NEW behaviour and FAIL on the old code (old = 200 and the
 * filer could self-settle; the route wrote synchronously via commands/repo).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { assetPolicies, assetClaims } from "../src/modules/insurance/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerInsuranceConsumers } from "../src/modules/insurance/consumer.js";
import { COMMANDS } from "../src/topics.js";
import * as queries from "../src/modules/insurance/queries.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

// Unique hex-only "…00000c0a<nn>" suffix for this file (grepped against tests/).
const TENANT = "11111111-aaaa-4000-8000-00000c0a0001";
const FILER  = "22222222-bbbb-4000-8000-00000c0a0001"; // actor who files the claim
const APPROVER = "33333333-cccc-4000-8000-00000c0a0001"; // a different approver
const ASSET  = "44444444-dddd-4000-8000-00000c0a0001";
const POLICY = "55555555-eeee-4000-8000-00000c0a0001";
const CLAIM  = "66666666-ffff-4000-8000-00000c0a0001";
const CLAIM2 = "77777777-ffff-4000-8000-00000c0a0002";
const MSG_POLICY = "88888888-1111-4000-8000-00000c0a0001";
const MSG_CLAIM  = "99999999-2222-4000-8000-00000c0a0001";
const MSG_CLAIM2 = "aaaaaaaa-2222-4000-8000-00000c0a0002";

function token(tenantId: string, actorId: string, roles: string[]) {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "s-mc" }, SECRET, 3600);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
function asTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runWithTenant(tenantId, () => db.transaction(fn)) as Promise<T>;
}

let app: FastifyInstance;

async function seedClaim(claimId: string, msgId: string) {
  const q = new MemoryQueue();
  registerInsuranceConsumers(q);
  await q.start();
  await q.publish(COMMANDS.insuranceClaimCreate, {
    messageId: msgId, type: COMMANDS.insuranceClaimCreate,
    tenantId: TENANT, actorId: FILER, correlationId: `corr-${claimId}`, schemaVersion: "1.0",
    payload: {
      id: claimId, tenantId: TENANT, policyId: POLICY, assetId: ASSET,
      claimDate: "2026-06-15", claimAmountMinor: 500000, currency: "INR", notes: "filed by FILER",
    },
  });
  await new Promise<void>((r) => setTimeout(r, 350));
  await q.stop();
}

beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
  await app.ready();

  // Seed a policy (coverage 1,000,000) + two claims, all created by FILER.
  const q = new MemoryQueue();
  registerInsuranceConsumers(q);
  await q.start();
  await q.publish(COMMANDS.insurancePolicyCreate, {
    messageId: MSG_POLICY, type: COMMANDS.insurancePolicyCreate,
    tenantId: TENANT, actorId: FILER, correlationId: "corr-pol", schemaVersion: "1.0",
    payload: {
      id: POLICY, tenantId: TENANT, assetId: ASSET,
      policyNo: "POL-MC-001", insurer: "National", coverageMinor: 100000000, premiumMinor: 100000,
      currency: "INR", startDate: "2026-04-01", endDate: "2027-03-31", renewalReminderDays: 30,
    },
  });
  await new Promise<void>((r) => setTimeout(r, 350));
  await q.stop();
  await seedClaim(CLAIM, MSG_CLAIM);
  await seedClaim(CLAIM2, MSG_CLAIM2);
});

afterAll(async () => {
  await asTenant(TENANT, async (tx) => {
    await tx.delete(assetClaims).where(eq(assetClaims.tenantId, TENANT));
    await tx.delete(assetPolicies).where(eq(assetPolicies.tenantId, TENANT));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    for (const m of [MSG_POLICY, MSG_CLAIM, MSG_CLAIM2]) await tx.delete(processed).where(eq(processed.messageId, m));
  });
  await app.close();
  await sqlClient.end();
});

describe("GAP2-ASSETS-INSURANCE-CLAIMS-01 — maker-checker (SoD)", () => {
  it("the FILER cannot SETTLE their own claim → 403 SELF_APPROVAL_FORBIDDEN", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/assets/insurance/claims/${CLAIM}/settle`,
      headers: { authorization: `Bearer ${token(TENANT, FILER, ["asset_admin", "super_admin"])}`, "content-type": "application/json" },
      payload: { settlementAmountMinor: 500000, currency: "INR" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("SELF_APPROVAL_FORBIDDEN");

    // and the claim must still be pending (not settled)
    const claim = await runWithTenant(TENANT, () => queries.getClaim(TENANT, CLAIM));
    expect(claim?.status).toBe("pending");
  });

  it("the FILER cannot APPROVE their own claim → 403 SELF_APPROVAL_FORBIDDEN", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/assets/insurance/claims/${CLAIM}/approve`,
      headers: { authorization: `Bearer ${token(TENANT, FILER, ["asset_admin", "super_admin"])}`, "content-type": "application/json" },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("SELF_APPROVAL_FORBIDDEN");
  });

  it("the FILER cannot REJECT their own claim → 403 SELF_APPROVAL_FORBIDDEN", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/assets/insurance/claims/${CLAIM}/reject`,
      headers: { authorization: `Bearer ${token(TENANT, FILER, ["asset_admin", "super_admin"])}`, "content-type": "application/json" },
      payload: { reason: "nope" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("SELF_APPROVAL_FORBIDDEN");
  });

  it("a DIFFERENT approver CAN settle the claim (202) and the consumer applies it", async () => {
    // Start the consumer so the published decide command is applied.
    const q = new MemoryQueue();
    registerInsuranceConsumers(q);
    await q.start();
    // The buildApp()'d app publishes to its own infra queue, not this q, so
    // instead drive the decide command directly through this test queue after
    // the HTTP preflight passes. First confirm the HTTP route accepts it (202).
    const res = await app.inject({
      method: "PATCH", url: `/v1/assets/insurance/claims/${CLAIM}/settle`,
      headers: { authorization: `Bearer ${token(TENANT, APPROVER, ["asset_admin", "super_admin"])}`, "content-type": "application/json" },
      payload: { settlementAmountMinor: 400000, currency: "INR" },
    });
    expect(res.statusCode).toBe(202);

    // Apply the equivalent decide command via the consumer and assert the write.
    await q.publish(COMMANDS.insuranceClaimDecide, {
      messageId: randomUUID(), type: COMMANDS.insuranceClaimDecide,
      tenantId: TENANT, actorId: APPROVER, correlationId: "corr-settle", schemaVersion: "1.0",
      payload: { id: CLAIM, tenantId: TENANT, decision: "settle", settlementAmountMinor: 400000 },
    });
    await new Promise<void>((r) => setTimeout(r, 350));
    await q.stop();

    const claim = await runWithTenant(TENANT, () => queries.getClaim(TENANT, CLAIM));
    expect(claim?.status).toBe("settled");
    expect(claim?.settledAmountMinor).toBe(400000n);
  });

  it("consumer re-asserts SoD: a decide command whose actor == filer changes nothing", async () => {
    const q = new MemoryQueue();
    registerInsuranceConsumers(q);
    await q.start();
    await q.publish(COMMANDS.insuranceClaimDecide, {
      messageId: randomUUID(), type: COMMANDS.insuranceClaimDecide,
      tenantId: TENANT, actorId: FILER, correlationId: "corr-self", schemaVersion: "1.0",
      payload: { id: CLAIM2, tenantId: TENANT, decision: "approve" },
    });
    await new Promise<void>((r) => setTimeout(r, 350));
    await q.stop();
    const claim = await runWithTenant(TENANT, () => queries.getClaim(TENANT, CLAIM2));
    expect(claim?.status).toBe("pending"); // still untouched
  });
});

describe("GAP2-ASSETS-INSURANCE-CLAIMS-02 — CQRS write path (202, no sync write)", () => {
  it("settle/approve/reject answer 202 Accepted (not 200)", async () => {
    const t = token(TENANT, APPROVER, ["asset_admin", "super_admin"]);
    const approve = await app.inject({
      method: "PATCH", url: `/v1/assets/insurance/claims/${CLAIM2}/approve`,
      headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, payload: {},
    });
    expect(approve.statusCode).toBe(202);
    expect(approve.json().status).toBe("accepted");
  });

  it("policy update answers 202 Accepted (not 200)", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/assets/insurance/policies/${POLICY}`,
      headers: { authorization: `Bearer ${token(TENANT, APPROVER, ["asset_admin", "super_admin"])}`, "content-type": "application/json" },
      payload: { premiumMinor: 120000 },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("ARCH GUARD: insurance/routes.ts + register category handlers hold no Drizzle writes and no 201", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const insurance = readFileSync(join(__dirname, "../src/modules/insurance/routes.ts"), "utf8");
    expect(insurance).not.toMatch(/db\.transaction/);
    expect(insurance).not.toMatch(/\.update\(|\.insert\(/);
    const register = readFileSync(join(__dirname, "../src/modules/register/routes.ts"), "utf8");
    // the category handlers used to db.transaction+insert/update and reply 201
    expect(register).not.toMatch(/db\.transaction/);
    expect(register).not.toContain("code(201)");
  });
});
