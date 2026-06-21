/**
 * asset-service test suite
 *
 * Test 1 — SLM depreciation (pure): cost=1000000, salvage=0, life=5yr → monthly=16666
 * Test 2 — WDV depreciation (pure): book_value, rate — verify formula
 * Test 3 — Period generation: start/end dates → correct period count
 * Test 4 — Disposal gain/loss (pure): proceeds vs book_value
 * Test 5 — CQRS wiring: POST /assets → queue → consumer → DB (MemoryQueue)
 * Test 6 — Asset status constraint: disposed asset cannot be re-disposed
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { assetAssets } from "../src/modules/register/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerRegisterConsumers } from "../src/modules/register/consumer.js";
import { slmMonthlyAmount, wdvMonthlyAmount, generatePeriods } from "../src/modules/depreciation/domain.js";
import { assertAssetDisposable, computeDisposalGainLoss } from "../src/modules/lifecycle/domain.js";
import { COMMANDS } from "../src/topics.js";

const ACTOR   = "00000000-aaaa-4000-8000-000000000001";
const TENANT  = "11111111-aaaa-4000-8000-000000000001";
const ASSET_1 = "22222222-bbbb-4000-8000-000000000001";
const ASSET_2 = "33333333-cccc-4000-8000-000000000002";
const MSG_1   = "44444444-dddd-4000-8000-000000000001";
const MSG_2   = "55555555-eeee-4000-8000-000000000002";

async function wipe(assetId: string, msgId: string) {
  await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  await db.delete(assetAssets).where(eq(assetAssets.id, assetId));
  await db.delete(processed).where(eq(processed.messageId, msgId));
}

// ── 1. SLM depreciation — pure ────────────────────────────────────────────

describe("Depreciation domain — SLM (pure)", () => {
  it("cost=1000000 salvage=0 life=5yr → monthly=16666", () => {
    const monthly = slmMonthlyAmount({
      acquisitionCostMinor: 1000000n,
      salvageValueMinor:    0n,
      usefulLifeYears:      5,
    });
    // 1000000 / 5 / 12 = 16666 (integer division)
    expect(monthly).toBe(16666n);
  });

  it("cost=1200000 salvage=200000 life=5yr → monthly=16666", () => {
    const monthly = slmMonthlyAmount({
      acquisitionCostMinor: 1200000n,
      salvageValueMinor:    200000n,
      usefulLifeYears:      5,
    });
    // (1200000-200000)/5/12 = 1000000/5/12 = 16666
    expect(monthly).toBe(16666n);
  });
});

// ── 2. WDV depreciation — pure ────────────────────────────────────────────

describe("Depreciation domain — WDV (pure)", () => {
  it("book_value=1000000 rate=20% → monthly=16666", () => {
    const monthly = wdvMonthlyAmount({ bookValueMinor: 1000000n, ratePercent: 20 });
    // 1000000 * 2000 / 120000 = 2000000000 / 120000 = 16666
    expect(monthly).toBe(16666n);
  });

  it("zero book value returns 0", () => {
    expect(wdvMonthlyAmount({ bookValueMinor: 0n, ratePercent: 20 })).toBe(0n);
  });
});

// ── 3. Period generation — pure ───────────────────────────────────────────

describe("Depreciation domain — period generation (pure)", () => {
  it("generates correct number of months", () => {
    const periods = generatePeriods("2024-01-01", "2024-03-31");
    expect(periods).toEqual(["2024-01", "2024-02", "2024-03"]);
  });

  it("year boundary handled correctly", () => {
    const periods = generatePeriods("2023-11-01", "2024-02-01");
    expect(periods).toEqual(["2023-11", "2023-12", "2024-01", "2024-02"]);
  });
});

// ── 4. Disposal gain/loss — pure ──────────────────────────────────────────

describe("Lifecycle domain — disposal gain/loss (pure)", () => {
  it("proceeds > book_value → positive gain", () => {
    expect(computeDisposalGainLoss(150000n, 100000n)).toBe(50000n);
  });

  it("proceeds < book_value → negative loss", () => {
    expect(computeDisposalGainLoss(60000n, 100000n)).toBe(-40000n);
  });

  it("proceeds = book_value → zero", () => {
    expect(computeDisposalGainLoss(100000n, 100000n)).toBe(0n);
  });

  it("disposed asset throws on second disposal attempt", () => {
    expect(() => assertAssetDisposable("disposed")).toThrowError("ASSET_ALREADY_DISPOSED");
  });
});

// ── 5. CQRS wiring — asset create ────────────────────────────────────────

describe("Register consumer — CQRS wiring (integration)", () => {
  beforeAll(async () => { await wipe(ASSET_1, MSG_1); });
  afterAll(async () => { await wipe(ASSET_1, MSG_1); });

  it("happy path: asset.asset.create inserts row and records _inbox.processed", async () => {
    const q = new MemoryQueue();
    registerRegisterConsumers(q);
    await q.start();

    await q.publish(COMMANDS.assetCreate, {
      messageId: MSG_1, type: COMMANDS.assetCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-asset-1", schemaVersion: "1.0",
      payload: {
        id: ASSET_1, tenantId: TENANT,
        name: "HP Laptop 15.6",
        code: "LAP-001",
        categoryId: "00000000-0000-4000-8000-000000000001",
        acquisitionCost: 8500000,
        salvageValue: 500000,
        usefulLifeYears: 5, depRate: 20, depMethod: "SLM",
        currency: "INR",
        acquisitionDate: "2024-01-15",
      },
    });

    await new Promise<void>((r) => setTimeout(r, 500));
    await q.stop();

    const rows = await db.select().from(assetAssets).where(eq(assetAssets.id, ASSET_1));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("HP Laptop 15.6");
    expect(rows[0]?.acquisitionCost).toBe(8500000n);
    expect(rows[0]?.bookValue).toBe(8500000n);
    expect(rows[0]?.status).toBe("active");

    const seen = await db.select().from(processed).where(eq(processed.messageId, MSG_1));
    expect(seen).toHaveLength(1);

    const outbox = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    expect(outbox.map((r) => r.eventType)).toContain("audit.event.record");
  });
});

// ── 5b. HTTP route auth guard (inject) ───────────────────────────────────

describe("asset-service route auth (inject)", () => {
  it("GET /v1/assets/assets without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/assets/assets" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("GET /v1/assets/assets/:id without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/assets/assets/00000000-0000-4000-8000-000000000001" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("GET /v1/assets/dashboard without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/assets/dashboard" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("GET /v1/assets/maintenance without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/assets/maintenance" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

// ── 6. Idempotency — duplicate message ───────────────────────────────────

describe("Register consumer — idempotency (integration)", () => {
  beforeAll(async () => { await wipe(ASSET_2, MSG_2); });
  afterAll(async () => {
    await wipe(ASSET_2, MSG_2);
    await sqlClient.end();
  });

  it("duplicate message is silently skipped", async () => {
    const q = new MemoryQueue();
    registerRegisterConsumers(q);
    await q.start();

    const payload = {
      messageId: MSG_2, type: COMMANDS.assetCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-asset-2", schemaVersion: "1.0",
      payload: {
        id: ASSET_2, tenantId: TENANT,
        name: "Dell Monitor 24",
        code: "MON-001",
        categoryId: "00000000-0000-4000-8000-000000000002",
        acquisitionCost: 2500000,
        acquisitionDate: "2024-02-01",
      },
    };

    await q.publish(COMMANDS.assetCreate, payload);
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.publish(COMMANDS.assetCreate, payload);
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.stop();

    const rows = await db.select().from(assetAssets).where(eq(assetAssets.id, ASSET_2));
    expect(rows).toHaveLength(1);
  });
});
