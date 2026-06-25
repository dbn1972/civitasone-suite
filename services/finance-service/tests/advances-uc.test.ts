/**
 * finance-service — advances + utilization-certificate create flows.
 *
 * Mirrors the canonical bill CQRS coverage in finance.test.ts:
 *   - HTTP surface: 401 (unauth), 400 (validation), 202 (accepted into queue).
 *   - Consumer (MemoryQueue): happy path inserts the row, records
 *     _inbox.processed, and emits an audit.event.record outbox entry.
 *
 * Advances/UCs carry no budget/master dependencies, so they run against any
 * tenant; we use a dedicated test tenant and clean up by id/correlationId.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { financeAdvances, financeUC } from "../src/modules/payments/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerPaymentsConsumers } from "../src/modules/payments/consumer.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000077";
const ACTOR  = "00000000-aaaa-4000-8000-000000000077";

const ADV_ID  = "12121212-aaaa-4000-8000-000000000001";
const ADV_MSG = "12121212-bbbb-4000-8000-000000000001";
const ADV_CORR = "corr-advance-happy-1";
const UC_ID   = "13131313-aaaa-4000-8000-000000000001";
const UC_MSG  = "13131313-bbbb-4000-8000-000000000001";
const UC_CORR = "corr-uc-happy-1";

function makeToken(roles: string[] = ["finance_officer"], tid = TENANT) {
  return signToken({ sub: "user-077", tid, roles, sid: "sess-077" }, SECRET);
}

async function wipeAdvance() {
  await db.delete(outboxMessages).where(eq(outboxMessages.correlationId, ADV_CORR));
  await db.delete(financeAdvances).where(eq(financeAdvances.id, ADV_ID));
  await db.delete(processed).where(eq(processed.messageId, ADV_MSG));
}
async function wipeUC() {
  await db.delete(outboxMessages).where(eq(outboxMessages.correlationId, UC_CORR));
  await db.delete(financeUC).where(eq(financeUC.id, UC_ID));
  await db.delete(processed).where(eq(processed.messageId, UC_MSG));
}

async function waitFor(fn: () => Promise<boolean>, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

afterAll(async () => { await sqlClient.end(); });

// ── POST /v1/finance/advances — HTTP surface ────────────────────────────────

describe("POST /v1/finance/advances — HTTP surface", () => {
  it("rejects unauthenticated request with 401", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/finance/advances",
      headers: { "content-type": "application/json" },
      payload: { advanceNo: "ADV-1", purpose: "Travel", amountMinor: 5000 },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("rejects an invalid body (missing amountMinor) with 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/finance/advances",
      headers: { authorization: `Bearer ${makeToken()}`, "content-type": "application/json" },
      payload: { advanceNo: "ADV-BAD", purpose: "Travel" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("rejects a non-positive amount with 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/finance/advances",
      headers: { authorization: `Bearer ${makeToken()}`, "content-type": "application/json" },
      payload: { advanceNo: "ADV-ZERO", purpose: "Travel", amountMinor: 0 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("accepts a valid advance and returns 202 (CQRS async pattern)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/finance/advances",
      headers: { authorization: `Bearer ${makeToken()}`, "content-type": "application/json" },
      payload: { advanceNo: "ADV-OK-1", purpose: "Site visit", payee: "R. Sharma", amountMinor: 250000, currency: "INR", dueDate: "2025-12-31" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("accepted");
    expect(typeof body.id).toBe("string");
  });
});

// ── advance consumer — happy path inserts row + audit ───────────────────────

describe("advance consumer — CQRS wiring (integration)", () => {
  beforeAll(async () => { await wipeAdvance(); });
  afterAll(async () => { await wipeAdvance(); });

  it("inserts the advance row, records processed, and emits audit", async () => {
    const q = new MemoryQueue();
    registerPaymentsConsumers(q);
    await q.start();

    await q.publish("finance.advance.create", {
      messageId: ADV_MSG, type: "finance.advance.create",
      tenantId: TENANT, actorId: ACTOR, correlationId: ADV_CORR, schemaVersion: "1.0",
      payload: {
        id: ADV_ID, tenantId: TENANT, advanceNo: "ADV-CONSUMER-1",
        purpose: "Field survey advance", payee: "Field Office", type: "employee",
        amountMinor: 500000, currency: "INR", dueDate: "2025-11-30",
      },
    });

    await waitFor(async () =>
      (await db.select().from(processed).where(eq(processed.messageId, ADV_MSG))).length === 1);
    await q.stop();

    const rows = await db.select().from(financeAdvances).where(eq(financeAdvances.id, ADV_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.advanceNo).toBe("ADV-CONSUMER-1");
    expect(rows[0]?.beneficiary).toBe("Field Office");
    expect(rows[0]?.purpose).toBe("Field survey advance");
    expect(rows[0]?.amountMinor).toBe(500000n);
    expect(rows[0]?.status).toBe("active");
    expect(rows[0]?.tenantId).toBe(TENANT);

    const outbox = await db.select().from(outboxMessages).where(eq(outboxMessages.correlationId, ADV_CORR));
    expect(outbox.map((r) => r.eventType)).toContain("audit.event.record");
  });
});

// ── POST /v1/finance/utilization-certificates — HTTP surface ────────────────

describe("POST /v1/finance/utilization-certificates — HTTP surface", () => {
  it("rejects unauthenticated request with 401", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/finance/utilization-certificates",
      headers: { "content-type": "application/json" },
      payload: { ucNo: "UC-1", purpose: "Q1 spend", amountMinor: 5000 },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("rejects an invalid body (missing amountMinor) with 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/finance/utilization-certificates",
      headers: { authorization: `Bearer ${makeToken()}`, "content-type": "application/json" },
      payload: { ucNo: "UC-BAD", purpose: "Q1 spend" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("accepts a valid UC and returns 202 (CQRS async pattern)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/finance/utilization-certificates",
      headers: { authorization: `Bearer ${makeToken()}`, "content-type": "application/json" },
      payload: { ucNo: "UC-OK-1", purpose: "Scheme X utilisation", scheme: "PMAY-G", amountMinor: 750000, currency: "INR" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("accepted");
    expect(typeof body.id).toBe("string");
  });
});

// ── UC consumer — happy path inserts row + audit ────────────────────────────

describe("utilization-certificate consumer — CQRS wiring (integration)", () => {
  beforeAll(async () => { await wipeUC(); });
  afterAll(async () => { await wipeUC(); });

  it("inserts the UC row, records processed, and emits audit", async () => {
    const q = new MemoryQueue();
    registerPaymentsConsumers(q);
    await q.start();

    await q.publish("finance.uc.create", {
      messageId: UC_MSG, type: "finance.uc.create",
      tenantId: TENANT, actorId: ACTOR, correlationId: UC_CORR, schemaVersion: "1.0",
      payload: {
        id: UC_ID, tenantId: TENANT, ucNo: "UC-CONSUMER-1",
        purpose: "Annual grant utilisation", scheme: "NHM-2024",
        amountMinor: 1200000, currency: "INR",
      },
    });

    await waitFor(async () =>
      (await db.select().from(processed).where(eq(processed.messageId, UC_MSG))).length === 1);
    await q.stop();

    const rows = await db.select().from(financeUC).where(eq(financeUC.id, UC_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ucNo).toBe("UC-CONSUMER-1");
    expect(rows[0]?.grantee).toBe("NHM-2024");
    expect(rows[0]?.grantRef).toBe("NHM-2024");
    expect(rows[0]?.purpose).toBe("Annual grant utilisation");
    expect(rows[0]?.amountMinor).toBe(1200000n);
    expect(rows[0]?.status).toBe("submitted");
    expect(rows[0]?.tenantId).toBe(TENANT);

    const outbox = await db.select().from(outboxMessages).where(eq(outboxMessages.correlationId, UC_CORR));
    expect(outbox.map((r) => r.eventType)).toContain("audit.event.record");
  });
});
