/**
 * SVC-095 RTI — legal-service.
 *
 * Covers:
 *  1. Pure domain: statutory timeline / deadline calc, appeal-tier ordering,
 *     maker-checker guard, status transitions (no DB).
 *  2. Route auth/validation (401/403/202/400).
 *  3. Consumer integration: receipt computes 30-day deadline; third-party
 *     consult extends to 40 days; transfer restarts the clock + emits event;
 *     respond records disposal; appeal filing + tier ordering.
 *  4. Maker-checker: an appeal order by the SAME actor who filed is rejected;
 *     a DIFFERENT actor decides it successfully.
 *  5. RLS cross-tenant isolation: tenant B never sees tenant A's application.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { rtiApplications, rtiAppeals } from "../src/modules/rti/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerRtiConsumers } from "../src/modules/rti/consumer.js";
import { COMMANDS } from "../src/topics.js";
import {
  computeResponseDeadline, computeTransferDeadline, computeAppealDisposalDeadline,
  isOverdue, daysRemaining, assertAppealTierAllowed, assertDifferentActor,
  assertStatusTransition, DomainError,
  NORMAL_RESPONSE_DAYS, THIRD_PARTY_RESPONSE_DAYS, FIRST_APPEAL_DISPOSAL_DAYS,
  LIFE_LIBERTY_HOURS,
} from "../src/modules/rti/domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
function token(roles: string[], tenantId: string, actorId: string) {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-1" }, SECRET, 3600);
}
function wireTenantAwareQueue(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}

const DAY = 24 * 60 * 60 * 1000;

// ───────────────────────────── 1. pure domain ─────────────────────────────
describe("rti domain — statutory timeline (pure)", () => {
  const base = new Date("2026-01-01T00:00:00.000Z");

  it("normal disclosure window is 30 days from receipt", () => {
    const d = computeResponseDeadline(base, {});
    expect(d.getTime()).toBe(base.getTime() + NORMAL_RESPONSE_DAYS * DAY);
  });

  it("third-party consultation extends the window to 40 days", () => {
    const d = computeResponseDeadline(base, { thirdParty: true });
    expect(d.getTime()).toBe(base.getTime() + THIRD_PARTY_RESPONSE_DAYS * DAY);
  });

  it("life & liberty request collapses the window to 48 hours", () => {
    const d = computeResponseDeadline(base, { lifeOrLiberty: true });
    expect(d.getTime()).toBe(base.getTime() + LIFE_LIBERTY_HOURS * 60 * 60 * 1000);
  });

  it("life & liberty overrides third-party", () => {
    const d = computeResponseDeadline(base, { lifeOrLiberty: true, thirdParty: true });
    expect(d.getTime()).toBe(base.getTime() + LIFE_LIBERTY_HOURS * 60 * 60 * 1000);
  });

  it("transfer restarts the 30-day clock from the transfer date", () => {
    const t = new Date("2026-02-01T00:00:00.000Z");
    expect(computeTransferDeadline(t).getTime()).toBe(t.getTime() + NORMAL_RESPONSE_DAYS * DAY);
  });

  it("first appeal has a §19(6) 30-day disposal deadline; a second appeal has none", () => {
    // §19(6): first appellate authority disposes within 30 days of filing.
    expect(computeAppealDisposalDeadline(base, "first")!.getTime()).toBe(base.getTime() + FIRST_APPEAL_DISPOSAL_DAYS * DAY);
    // §19(3)'s 90 days is a FILING window (from the first-appeal order), NOT a
    // disposal deadline — so no disposal deadline is surfaced for a second appeal.
    expect(computeAppealDisposalDeadline(base, "second")).toBeNull();
  });

  it("isOverdue / daysRemaining reflect the deadline", () => {
    const deadline = new Date(base.getTime() + 10 * DAY);
    expect(isOverdue(deadline, new Date(base.getTime() + 11 * DAY))).toBe(true);
    expect(isOverdue(deadline, new Date(base.getTime() + 5 * DAY))).toBe(false);
    expect(daysRemaining(deadline, new Date(base.getTime() + 4 * DAY))).toBe(6);
    expect(daysRemaining(deadline, new Date(base.getTime() + 12 * DAY))).toBe(-2);
  });

  it("rejects an invalid received date", () => {
    expect(() => computeResponseDeadline(new Date("nonsense"), {})).toThrow(/INVALID_DATE/);
  });
});

describe("rti domain — appeal tier ordering (pure)", () => {
  it("allows a first appeal when none exists", () => {
    expect(() => assertAppealTierAllowed("first", [])).not.toThrow();
  });
  it("rejects a duplicate first appeal", () => {
    expect(() => assertAppealTierAllowed("first", [{ tier: "first", order: "pending" }])).toThrow(/APPEAL_EXISTS/);
  });
  it("rejects a second appeal with no first appeal", () => {
    expect(() => assertAppealTierAllowed("second", [])).toThrow(/FIRST_APPEAL_REQUIRED/);
  });
  it("rejects a second appeal while the first is still pending", () => {
    expect(() => assertAppealTierAllowed("second", [{ tier: "first", order: "pending" }])).toThrow(/FIRST_APPEAL_PENDING/);
  });
  it("allows a second appeal once the first is decided", () => {
    expect(() => assertAppealTierAllowed("second", [{ tier: "first", order: "rejected" }])).not.toThrow();
  });
});

describe("rti domain — maker-checker + transitions (pure)", () => {
  it("rejects an order decided by the same actor who filed it", () => {
    expect(() => assertDifferentActor("actor-1", "actor-1", "appeal order")).toThrow(/MAKER_CHECKER_VIOLATION/);
  });
  it("requires a deciding authority", () => {
    expect(() => assertDifferentActor("actor-1", "", "appeal order")).toThrow(/CHECKER_REQUIRED/);
  });
  it("allows an order decided by a different actor", () => {
    expect(() => assertDifferentActor("actor-1", "actor-2", "appeal order")).not.toThrow();
  });
  it("allows received → responded but rejects responded → received", () => {
    expect(() => assertStatusTransition("received", "responded")).not.toThrow();
    expect(() => assertStatusTransition("responded", "received")).toThrow(/INVALID_TRANSITION/);
  });
  it("DomainError carries the code", () => {
    const e = new DomainError("X", "y");
    expect(e.message).toContain("[X]");
  });
});

// ─────────────────────── 2/3/4/5. route + integration ─────────────────────
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR_A = randomUUID();
const ACTOR_B = randomUUID();
const APP_1 = randomUUID();     // receipt/deadline
const APP_XFER = randomUUID();  // transfer
const APP_APPEAL = randomUUID();// appeal + maker-checker
const APPEAL_1 = randomUUID();
let app: FastifyInstance;

async function wipeTenant(t: string): Promise<void> {
  await runWithTenant(t, () => db.transaction(async (tx) => {
    await tx.delete(rtiAppeals).where(eq(rtiAppeals.tenantId, t));
    await tx.delete(rtiApplications).where(eq(rtiApplications.tenantId, t));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
  }));
}

describe("RTI routes + consumer integration", () => {
  beforeAll(async () => {
    app = await buildApp();
    await wipeTenant(TENANT_A);
    await wipeTenant(TENANT_B);
  });
  afterAll(async () => {
    await wipeTenant(TENANT_A);
    await wipeTenant(TENANT_B);
    await app.close();
    await sqlClient.end();
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/legal/rti/applications", payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a non-PIO role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/rti/applications",
      headers: { authorization: `Bearer ${token(["employee"], TENANT_A, ACTOR_A)}`, "content-type": "application/json" },
      payload: { applicationNo: "RTI-1", applicantName: "A", subject: "s", requestText: "r" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("400 for a missing required field", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/rti/applications",
      headers: { authorization: `Bearer ${token(["rti_pio"], TENANT_A, ACTOR_A)}`, "content-type": "application/json" },
      payload: { applicantName: "A" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("202 accepts a valid RTI application", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/rti/applications",
      headers: { authorization: `Bearer ${token(["rti_pio"], TENANT_A, ACTOR_A)}`, "content-type": "application/json" },
      payload: { applicationNo: "RTI-ROUTE-1", applicantName: "Ravi", subject: "Roads", requestText: "Details of road works", feePaid: 10 },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("receipt consumer computes the 30-day statutory deadline and lands the row", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerRtiConsumers(q);
    await q.start();
    const receivedAt = new Date("2026-03-01T00:00:00.000Z");
    await q.publish(COMMANDS.rtiApplicationCreate, {
      messageId: randomUUID(), type: COMMANDS.rtiApplicationCreate,
      tenantId: TENANT_A, actorId: ACTOR_A, correlationId: "c1", schemaVersion: "1.0",
      payload: {
        id: APP_1, tenantId: TENANT_A, applicationNo: "RTI-CONS-1", applicantName: "Meera",
        subject: "Budget", requestText: "Copy of budget", receivedAt: receivedAt.toISOString(),
      },
    });
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.stop();

    const rows = await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.select().from(rtiApplications).where(eq(rtiApplications.id, APP_1))));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.status).toBe("received");
    expect(new Date(row.deadlineAt).getTime()).toBe(receivedAt.getTime() + NORMAL_RESPONSE_DAYS * DAY);
  });

  it("transfer restarts the clock, moves status, and emits a cross-service event", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerRtiConsumers(q);
    await q.start();
    // seed
    await q.publish(COMMANDS.rtiApplicationCreate, {
      messageId: randomUUID(), type: COMMANDS.rtiApplicationCreate,
      tenantId: TENANT_A, actorId: ACTOR_A, correlationId: "c2", schemaVersion: "1.0",
      payload: { id: APP_XFER, tenantId: TENANT_A, applicationNo: "RTI-XFER-1", applicantName: "N", subject: "s", requestText: "r" },
    });
    await new Promise<void>((r) => setTimeout(r, 200));
    await q.publish(COMMANDS.rtiTransfer, {
      messageId: randomUUID(), type: COMMANDS.rtiTransfer,
      tenantId: TENANT_A, actorId: ACTOR_A, correlationId: "c2b", schemaVersion: "1.0",
      payload: { applicationId: APP_XFER, tenantId: TENANT_A, toAuthority: "PWD-PIO", reason: "subject matter" },
    });
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.stop();

    const rows = await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.select().from(rtiApplications).where(eq(rtiApplications.id, APP_XFER))));
    expect(rows[0]!.status).toBe("transferred");
    expect(rows[0]!.pioRef).toBe("PWD-PIO");
    const outbox = await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT_A))));
    expect(outbox.some((m: { topic?: string }) => m.topic === "legal.rti.transferred")).toBe(true);
  });

  it("maker-checker: appeal order by the FILER is rejected; a DIFFERENT authority decides it", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerRtiConsumers(q);
    await q.start();
    // seed application + respond so an appeal is meaningful
    await q.publish(COMMANDS.rtiApplicationCreate, {
      messageId: randomUUID(), type: COMMANDS.rtiApplicationCreate,
      tenantId: TENANT_A, actorId: ACTOR_A, correlationId: "c3", schemaVersion: "1.0",
      payload: { id: APP_APPEAL, tenantId: TENANT_A, applicationNo: "RTI-AP-1", applicantName: "P", subject: "s", requestText: "r" },
    });
    await new Promise<void>((r) => setTimeout(r, 200));
    // file first appeal — filed by ACTOR_A
    await q.publish(COMMANDS.rtiAppealFile, {
      messageId: randomUUID(), type: COMMANDS.rtiAppealFile,
      tenantId: TENANT_A, actorId: ACTOR_A, correlationId: "c3b", schemaVersion: "1.0",
      payload: { appealId: APPEAL_1, applicationId: APP_APPEAL, tenantId: TENANT_A, tier: "first", appellateAuthority: "FAA", grounds: "no response" },
    });
    await new Promise<void>((r) => setTimeout(r, 200));

    // maker == checker → order must NOT be applied (stays pending)
    await q.publish(COMMANDS.rtiAppealOrder, {
      messageId: randomUUID(), type: COMMANDS.rtiAppealOrder,
      tenantId: TENANT_A, actorId: ACTOR_A, correlationId: "c3c", schemaVersion: "1.0",
      payload: { appealId: APPEAL_1, tenantId: TENANT_A, orderStatus: "allowed", orderText: "disclose" },
    });
    await new Promise<void>((r) => setTimeout(r, 300));
    let rows = await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.select().from(rtiAppeals).where(eq(rtiAppeals.id, APPEAL_1))));
    expect(rows[0]!.orderStatus).toBe("pending");
    expect(rows[0]!.decidedBy).toBeNull();

    // different authority → order applied
    await q.publish(COMMANDS.rtiAppealOrder, {
      messageId: randomUUID(), type: COMMANDS.rtiAppealOrder,
      tenantId: TENANT_A, actorId: ACTOR_B, correlationId: "c3d", schemaVersion: "1.0",
      payload: { appealId: APPEAL_1, tenantId: TENANT_A, orderStatus: "allowed", orderText: "disclose" },
    });
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.stop();
    rows = await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.select().from(rtiAppeals).where(eq(rtiAppeals.id, APPEAL_1))));
    expect(rows[0]!.orderStatus).toBe("allowed");
    expect(rows[0]!.decidedBy).toBe(ACTOR_B);
  });

  it("second appeal carries NO disposal deadline; the first appeal keeps its §19(6) deadline", async () => {
    // APP_APPEAL already has a DISPOSED first appeal (APPEAL_1 was decided above),
    // so a second appeal is now competent.
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerRtiConsumers(q);
    await q.start();
    const appeal2 = randomUUID();
    await q.publish(COMMANDS.rtiAppealFile, {
      messageId: randomUUID(), type: COMMANDS.rtiAppealFile,
      tenantId: TENANT_A, actorId: ACTOR_A, correlationId: "c3e", schemaVersion: "1.0",
      payload: { appealId: appeal2, applicationId: APP_APPEAL, tenantId: TENANT_A, tier: "second", appellateAuthority: "SIC", grounds: "FAA delay" },
    });
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.stop();

    const first = await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.select().from(rtiAppeals).where(eq(rtiAppeals.id, APPEAL_1))));
    const second = await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.select().from(rtiAppeals).where(eq(rtiAppeals.id, appeal2))));
    expect(second).toHaveLength(1);
    expect(second[0]!.tier).toBe("second");
    // The second appeal has no fabricated disposal deadline …
    expect(second[0]!.deadlineAt).toBeNull();
    // … while the first appeal retains its §19(6) 30-day disposal deadline.
    expect(first[0]!.deadlineAt).not.toBeNull();
    expect(new Date(first[0]!.deadlineAt!).getTime()).toBe(new Date(first[0]!.filedAt).getTime() + FIRST_APPEAL_DISPOSAL_DAYS * DAY);
  });

  it("RLS cross-tenant: tenant B does not see tenant A's application via the API", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/legal/rti/applications",
      headers: { authorization: `Bearer ${token(["rti_pio"], TENANT_B, ACTOR_B)}`, "x-tenant-id": TENANT_B },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as { id: string }[];
    expect(items.find((i) => i.id === APP_1)).toBeUndefined();
    expect(items.find((i) => i.id === APP_APPEAL)).toBeUndefined();
  });

  it("tenant A list (scoped by x-tenant-id) DOES see its own applications", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/legal/rti/applications",
      headers: { authorization: `Bearer ${token(["rti_pio"], TENANT_A, ACTOR_A)}`, "x-tenant-id": TENANT_A },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as { id: string }[];
    expect(items.find((i) => i.id === APP_APPEAL)).toBeDefined();
  });

  it("tenant A DETAIL view returns the application with timeline + appeals", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/legal/rti/applications/${APP_APPEAL}`,
      headers: { authorization: `Bearer ${token(["rti_pio"], TENANT_A, ACTOR_A)}`, "x-tenant-id": TENANT_A },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.applicationNo).toBe("RTI-AP-1");
    expect(Array.isArray(body.appeals)).toBe(true);
    expect(typeof body.daysRemaining).toBe("number");
  });

  // ── route → command coverage: every mutation endpoint accepts (202) ────────
  const H = { authorization: `Bearer ${token(["rti_pio"], TENANT_A, ACTOR_A)}`, "content-type": "application/json" };
  const HA = { authorization: `Bearer ${token(["rti_appellate"], TENANT_A, ACTOR_B)}`, "content-type": "application/json" };

  it("POST transfer / third-party-consult / additional-fee / respond / appeal / disclosure all accept (202)", async () => {
    const post = (url: string, payload: unknown, headers = H) => app.inject({ method: "POST", url, headers, payload });
    expect((await post(`/v1/legal/rti/applications/${APP_1}/transfer`, { toAuthority: "PWD" })).statusCode).toBe(202);
    expect((await post(`/v1/legal/rti/applications/${APP_1}/third-party-consult`, { thirdParty: "Acme Ltd" })).statusCode).toBe(202);
    expect((await post(`/v1/legal/rti/applications/${APP_1}/additional-fee`, { additionalFee: 40 })).statusCode).toBe(202);
    expect((await post(`/v1/legal/rti/applications/${APP_1}/respond`, { decision: "partial", responseText: "partial disclosure", exemptions: [{ section: "8(1)(j)", justification: "personal info" }] })).statusCode).toBe(202);
    expect((await post(`/v1/legal/rti/applications/${APP_1}/appeals`, { tier: "first", appellateAuthority: "FAA", grounds: "delay" })).statusCode).toBe(202);
    expect((await post(`/v1/legal/rti/applications/${APP_1}/appeals/${randomUUID()}/order`, { orderStatus: "allowed", orderText: "disclose" }, HA)).statusCode).toBe(202);
    expect((await post(`/v1/legal/rti/disclosures`, { category: "budget", description: "annual budget published" })).statusCode).toBe(202);
  });

  it("GET disclosures returns the log", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/legal/rti/disclosures", headers: { authorization: `Bearer ${token(["rti_pio"], TENANT_A, ACTOR_A)}`, "x-tenant-id": TENANT_A } });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().items)).toBe(true);
  });

  // ── consumer coverage: respond (with §8 exemptions), consult, fee, disclosure
  it("consumer applies respond (with exemptions), third-party consult, additional fee, and disclosure", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerRtiConsumers(q);
    await q.start();
    const APP = randomUUID();
    await q.publish(COMMANDS.rtiApplicationCreate, {
      messageId: randomUUID(), type: COMMANDS.rtiApplicationCreate,
      tenantId: TENANT_A, actorId: ACTOR_A, correlationId: "cc", schemaVersion: "1.0",
      payload: { id: APP, tenantId: TENANT_A, applicationNo: "RTI-FLOW-1", applicantName: "Q", subject: "s", requestText: "r" },
    });
    await new Promise<void>((r) => setTimeout(r, 150));
    await q.publish(COMMANDS.rtiThirdPartyConsult, {
      messageId: randomUUID(), type: COMMANDS.rtiThirdPartyConsult,
      tenantId: TENANT_A, actorId: ACTOR_A, correlationId: "cc2", schemaVersion: "1.0",
      payload: { applicationId: APP, tenantId: TENANT_A, thirdParty: "Beta Corp" },
    });
    await new Promise<void>((r) => setTimeout(r, 150));
    await q.publish(COMMANDS.rtiAdditionalFee, {
      messageId: randomUUID(), type: COMMANDS.rtiAdditionalFee,
      tenantId: TENANT_A, actorId: ACTOR_A, correlationId: "cc3", schemaVersion: "1.0",
      payload: { applicationId: APP, tenantId: TENANT_A, additionalFee: 25 },
    });
    await new Promise<void>((r) => setTimeout(r, 150));
    await q.publish(COMMANDS.rtiRespond, {
      messageId: randomUUID(), type: COMMANDS.rtiRespond,
      tenantId: TENANT_A, actorId: ACTOR_A, correlationId: "cc4", schemaVersion: "1.0",
      payload: { applicationId: APP, tenantId: TENANT_A, decision: "partial", responseText: "partial", exemptions: [{ section: "8(1)(j)", justification: "personal information" }] },
    });
    await new Promise<void>((r) => setTimeout(r, 150));
    await q.publish(COMMANDS.rtiDisclosureLog, {
      messageId: randomUUID(), type: COMMANDS.rtiDisclosureLog,
      tenantId: TENANT_A, actorId: ACTOR_A, correlationId: "cc5", schemaVersion: "1.0",
      payload: { id: randomUUID(), applicationId: APP, tenantId: TENANT_A, category: "org", description: "org chart" },
    });
    await new Promise<void>((r) => setTimeout(r, 250));
    await q.stop();

    const rows = await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.select().from(rtiApplications).where(eq(rtiApplications.id, APP))));
    const row = rows[0]!;
    expect(row.status).toBe("responded");
    expect(row.thirdParty).toBe(true);
    expect(Number(row.additionalFee)).toBe(25);
  });
});
