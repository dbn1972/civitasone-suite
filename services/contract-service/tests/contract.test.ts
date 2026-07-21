/**
 * contract-service test suite
 *
 * Test 1 — Contract amendment (pure): only active contracts can be amended.
 * Test 2 — CQRS wiring: contract.contract.create → queue → consumer → DB.
 * Test 3 — Rate contract: rate-contract item lookup returns active RCs.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { contractContracts } from "../src/modules/contracts/schema.js";
import { contractRateContracts } from "../src/modules/rate/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerContractConsumers } from "../src/modules/contracts/consumer.js";
import { registerRateConsumers }     from "../src/modules/rate/consumer.js";
import { assertCanAmend }            from "../src/modules/contracts/domain.js";
import { EVENTS } from "../src/topics.js";

const ACTOR   = "00000000-aaaa-4000-8000-000000000001";
const TENANT  = "11111111-aaaa-4000-8000-000000000003";
const CON_1   = "22222222-bbbb-4000-8000-000000000003";
const RC_1    = "33333333-cccc-4000-8000-000000000003";
const MSG_C1  = "44444444-dddd-4000-8000-000000000003";
const MSG_RC1 = "44444444-dddd-4000-8000-000000000004";

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

async function wipe() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(contractContracts).where(eq(contractContracts.tenantId, TENANT));
    await tx.delete(contractRateContracts).where(eq(contractRateContracts.tenantId, TENANT));
    for (const id of [MSG_C1, MSG_RC1]) {
      await tx.delete(processed).where(eq(processed.messageId, id));
    }
  }));
}

// ── 1. Contract amendment — pure ─────────────────────────────────────────

describe("Contract domain — amendment guard (pure)", () => {
  it("active contract can be amended", () => {
    expect(() => assertCanAmend("active")).not.toThrow();
  });

  it("draft contract throws INVALID_STATUS", () => {
    expect(() => assertCanAmend("draft")).toThrowError("INVALID_STATUS");
  });

  it("expired contract throws INVALID_STATUS", () => {
    expect(() => assertCanAmend("expired")).toThrowError("INVALID_STATUS");
  });
});

// ── 2. CQRS wiring — contract create ─────────────────────────────────────

describe("Contract consumer — CQRS wiring (integration)", () => {
  beforeAll(async () => { await wipe(); });
  afterAll(async () => { await wipe(); });

  it("contract.contract.create inserts row and emits contract.contract.created", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerContractConsumers(q);
    await q.start();

    await q.publish("contract.contract.create", {
      messageId: MSG_C1,
      type: "contract.contract.create",
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: "corr-contract-1",
      schemaVersion: "1.0",
      payload: {
        id: CON_1, tenantId: TENANT,
        contractNo: "CON-2026-001",
        vendorId: "aaaaaaaa-3333-4000-8000-000000000001",
        title: "Security Services Contract",
        valueMinor: 28600000, currency: "INR",
        startDate: "2026-07-01", expiry: "2027-06-30",
      },
    });

    await new Promise<void>((r) => setTimeout(r, 500));
    await q.stop();

    const rows = await runWithTenant(TENANT, () => db.transaction(async (tx) => tx.select().from(contractContracts).where(eq(contractContracts.id, CON_1))));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.contractNo).toBe("CON-2026-001");
    expect(rows[0]?.status).toBe("draft");
    expect(rows[0]?.valueMinor).toBe(28600000n);

    const outbox = await runWithTenant(TENANT, () => db.transaction(async (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
    expect(outbox.map((r) => r.eventType)).toContain(EVENTS.contractCreated);
  });
});

// ── 3. Rate contract lookup ────────────────────────────────────────────────

describe("Rate contract consumer — CQRS wiring (integration)", () => {
  beforeAll(async () => { await wipe(); });
  afterAll(async () => { await wipe(); await sqlClient.end(); });

  it("rate contract is inserted and processable", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerRateConsumers(q);
    await q.start();

    await q.publish("contract.rate_contract.create", {
      messageId: MSG_RC1,
      type: "contract.rate_contract.create",
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: "corr-rc-1",
      schemaVersion: "1.0",
      payload: {
        id: RC_1, tenantId: TENANT, rcNo: "RC-2026-001",
        vendorId: "aaaaaaaa-4444-4000-8000-000000000001",
        title: "Annual Stationery Rate Contract",
        validFrom: "2026-04-01", validUntil: "2027-03-31",
        items: [
          { itemCode: "STA-001", description: "A4 Paper Ream", unit: "ream", unitPriceMinor: 22000 },
          { itemCode: "STA-002", description: "Ball Pen Box", unit: "box",  unitPriceMinor: 18000 },
        ],
      },
    });

    await new Promise<void>((r) => setTimeout(r, 500));
    await q.stop();

    const rcs = await runWithTenant(TENANT, () => db.transaction(async (tx) => tx.select().from(contractRateContracts).where(eq(contractRateContracts.id, RC_1))));
    expect(rcs).toHaveLength(1);
    expect(rcs[0]?.rcNo).toBe("RC-2026-001");
    expect(rcs[0]?.status).toBe("active");

    const proc = await runWithTenant(TENANT, () => db.transaction(async (tx) => tx.select().from(processed).where(eq(processed.messageId, MSG_RC1))));
    expect(proc).toHaveLength(1);
  });
});
