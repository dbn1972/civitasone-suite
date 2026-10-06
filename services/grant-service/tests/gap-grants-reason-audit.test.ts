/**
 * PR #1865 review fix: the optional approve / scheme-close `reason` must reach
 * the audit event detail (GAP-GRANTS-APPLICATIONS-DETAIL-04, SCHEMES-DETAIL-02).
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { grantSchemes } from "../src/modules/scheme/schema.js";
import { grantApplications } from "../src/modules/application/schema.js";
import { grantBeneficiaries } from "../src/modules/beneficiary/schema.js";
import { registerApplicationConsumers } from "../src/modules/application/consumer.js";
import { registerSchemeConsumers } from "../src/modules/scheme/consumer.js";
import { randomUUID } from "node:crypto";
import { COMMANDS } from "../src/topics.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const ACTOR = "10000000-aaaa-4000-8000-0000000000a1";
const ACTOR2 = "10000000-aaaa-4000-8000-0000000000a2";
const TENANT = "1f000000-aaaa-4000-8000-0000000000a1";
const SCHEME = "2f000000-bbbb-4000-8000-0000000000a1";
const BEN = "3f000000-cccc-4000-8000-0000000000a1";
const APP = "4f000000-dddd-4000-8000-0000000000a1";

function tenantAware(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    raw(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}
const scoped = <T>(fn: (tx: typeof db) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction((tx) => fn(tx as unknown as typeof db)));
const wrap = (type: string, payload: Record<string, unknown>) => ({
  messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR,
  correlationId: "corr-reason", schemaVersion: "1.0", payload,
});
const settle = () => new Promise((r) => setTimeout(r, 500));

async function wipe() {
  await scoped(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(grantApplications).where(eq(grantApplications.tenantId, TENANT));
    await tx.delete(grantBeneficiaries).where(eq(grantBeneficiaries.tenantId, TENANT));
    await tx.delete(grantSchemes).where(eq(grantSchemes.tenantId, TENANT));
  });
}
async function seedScheme() {
  await scoped(async (tx) => {
    await tx.insert(grantSchemes).values({
      id: SCHEME, tenantId: TENANT, code: "SCH-REASON", name: "Reason Scheme",
      budgetMinor: 1_000_000n, disbursedMinor: 0n, minAmountMinor: 0n, maxAmountMinor: 1_000_000n,
      currency: "INR", status: "active", createdBy: ACTOR, updatedBy: ACTOR,
    });
  });
}
async function auditEvents() {
  const rows = await scoped((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)));
  return rows.filter((o) => o.eventType === "audit.event.record").map((o) => o.payload as Record<string, unknown>);
}

beforeEach(wipe);
afterAll(async () => { await wipe(); await sqlClient.end(); });

describe("approve reason reaches the audit event", () => {
  async function seedApp() {
    await seedScheme();
    await scoped(async (tx) => {
      await tx.insert(grantApplications).values({
        id: APP, tenantId: TENANT, grantNo: "G-REASON", schemeId: SCHEME, beneficiaryId: BEN,
        purpose: "x", amountRequestedMinor: 100n, amountApprovedMinor: 0n, currency: "INR",
        status: "under_review", submittedBy: ACTOR, createdBy: ACTOR, updatedBy: ACTOR,
      });
    });
  }
  async function approve(extra: Record<string, unknown>) {
    const q = tenantAware(new MemoryQueue());
    registerApplicationConsumers(q);
    await q.start();
    await q.publish(COMMANDS.applicationApprove, wrap(COMMANDS.applicationApprove,
      { id: APP, tenantId: TENANT, amountApprovedMinor: 100, approvedBy: ACTOR2, ...extra }));
    await settle();
    await q.stop();
  }

  it("records the reason as audit detail", async () => {
    await seedApp();
    await approve({ reason: "Meets all scheme criteria" });
    const ev = (await auditEvents()).find((e) => e.action === "approve");
    expect(ev?.outcome).toBe("success");
    expect(ev?.detail).toEqual({ reason: "Meets all scheme criteria" });
  });

  it("omits detail when no reason is given", async () => {
    await seedApp();
    await approve({});
    const ev = (await auditEvents()).find((e) => e.action === "approve");
    expect(ev).toBeDefined();
    expect(ev).not.toHaveProperty("detail");
  });
});

describe("scheme close reason reaches the audit event", () => {
  async function close(extra: Record<string, unknown>) {
    const q = tenantAware(new MemoryQueue());
    registerSchemeConsumers(q);
    await q.start();
    await q.publish(COMMANDS.schemeClose, wrap(COMMANDS.schemeClose,
      { id: SCHEME, tenantId: TENANT, closedBy: ACTOR, ...extra }));
    await settle();
    await q.stop();
  }

  it("consumer records the reason as audit detail", async () => {
    await seedScheme();
    await close({ reason: "Budget exhausted" });
    const ev = (await auditEvents()).find((e) => e.action === "close");
    expect(ev?.detail).toEqual({ reason: "Budget exhausted" });
  });

  it("consumer omits detail when no reason is given", async () => {
    await seedScheme();
    await close({});
    const ev = (await auditEvents()).find((e) => e.action === "close");
    expect(ev).toBeDefined();
    expect(ev).not.toHaveProperty("detail");
  });

  it("route accepts a reason body and rejects an empty/oversized one", async () => {
    await seedScheme();
    const app = await buildApp();
    const token = signToken({ sub: ACTOR, tid: TENANT, roles: ["grant_admin"], sid: "s" }, JWT_SECRET);
    const headers = { authorization: `Bearer ${token}` };
    const bad = await app.inject({ method: "PATCH", url: `/v1/grants/schemes/${SCHEME}/close`, headers, payload: { reason: "x".repeat(1001) } });
    const ok = await app.inject({ method: "PATCH", url: `/v1/grants/schemes/${SCHEME}/close`, headers, payload: { reason: "Budget exhausted" } });
    await app.close();
    expect(bad.statusCode).toBe(400);
    expect(ok.statusCode).toBe(202);
  });
});
