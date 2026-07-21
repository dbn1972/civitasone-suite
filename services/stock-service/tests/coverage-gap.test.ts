/**
 * Coverage-gap tests: exercises functions that route-level tests cannot reach
 * (insert helpers, find-by-id, commands behind pre-checks, etc.)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { stockItems, stockItemCategories, stockUoms } from "../src/modules/item/schema.js";
import { stockEntries } from "../src/modules/entry/schema.js";
import { stockLedger } from "../src/modules/ledger/schema.js";
import { stockValuationRates } from "../src/modules/valuation/schema.js";
import { ewayBills } from "../src/modules/eway-bill/schema.js";
import * as itemRepo from "../src/modules/item/repo.js";
import * as entryRepo from "../src/modules/entry/repo.js";
import * as ewayRepo from "../src/modules/eway-bill/repo.js";
import * as valuationRepo from "../src/modules/valuation/repo.js";

const TENANT = "11111111-cccc-4000-8000-000000000001";
const ACTOR = "00000000-cccc-4000-8000-000000000001";
const SECRET = "test_secret_for_civitasone_32chr";

function token(roles: string[] = ["stock_admin", "super_admin"]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s-cov" }, SECRET, 3600);
}

// ══════════════════════════════════════════════════════════════════════════════
// ITEM REPO — insertItem, findItemById, findUomsByTenant
// ══════════════════════════════════════════════════════════════════════════════
describe("item/repo — insertItem + findItemById", () => {
  const ITEM_ID = randomUUID();
  const CAT_ID = randomUUID();
  const UOM_ID = randomUUID();

  beforeAll(async () => {
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(stockItemCategories).values({ id: CAT_ID, tenantId: TENANT, name: "Test Cat", code: "TC", createdBy: ACTOR, updatedBy: ACTOR });
      await tx.insert(stockUoms).values({ id: UOM_ID, tenantId: TENANT, name: "Piece", symbol: "pc", createdBy: ACTOR, updatedBy: ACTOR });
    }));
  });

  afterAll(async () => {
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.delete(stockItems).where(eq(stockItems.id, ITEM_ID));
      await tx.delete(stockItemCategories).where(eq(stockItemCategories.id, CAT_ID));
      await tx.delete(stockUoms).where(eq(stockUoms.id, UOM_ID));
    }));
  });

  it("insertItem persists row", async () => {
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await itemRepo.insertItem(tx, {
        id: ITEM_ID, tenantId: TENANT, name: "Cov Item", code: "CI-001",
        categoryId: CAT_ID, uomId: UOM_ID, createdBy: ACTOR, updatedBy: ACTOR,
      });
    }));
    const found = await itemRepo.findItemById(ITEM_ID, TENANT);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Cov Item");
  });

  it("findItemById returns null for wrong tenant", async () => {
    const found = await itemRepo.findItemById(ITEM_ID, randomUUID());
    expect(found).toBeNull();
  });

  it("findUomsByTenant returns seeded UOMs", async () => {
    const uoms = await itemRepo.findUomsByTenant(TENANT);
    expect(uoms.length).toBeGreaterThanOrEqual(1);
    const match = uoms.find(u => u.id === UOM_ID);
    expect(match).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ENTRY REPO — getCurrentBalance, findEntryById
// ══════════════════════════════════════════════════════════════════════════════
describe("entry/repo — getCurrentBalance + findEntryById", () => {
  const ENTRY_ID = randomUUID();
  const ITEM_ID = randomUUID();
  const WH_ID = randomUUID();

  beforeAll(async () => {
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(stockEntries).values({
        id: ENTRY_ID, tenantId: TENANT, entryType: "receipt", postingDate: "2024-06-01",
        status: "posted", createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(stockValuationRates).values({
        tenantId: TENANT, itemId: ITEM_ID, warehouseId: WH_ID,
        qty: 42, rateMinor: 100n, currency: "INR",
      });
    }));
  });

  afterAll(async () => {
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.delete(stockEntries).where(eq(stockEntries.id, ENTRY_ID));
      await tx.delete(stockValuationRates).where(
        and(eq(stockValuationRates.tenantId, TENANT), eq(stockValuationRates.itemId, ITEM_ID))
      );
    }));
  });

  it("getCurrentBalance returns qty from valuation_rates", async () => {
    const bal = await entryRepo.getCurrentBalance(TENANT, ITEM_ID, WH_ID);
    expect(bal).toBe(42);
  });

  it("getCurrentBalance returns 0 for non-existent combo", async () => {
    const bal = await entryRepo.getCurrentBalance(TENANT, randomUUID(), randomUUID());
    expect(bal).toBe(0);
  });

  it("findEntryById returns entry scoped to tenant", async () => {
    const entry = await entryRepo.findEntryById(ENTRY_ID, TENANT);
    expect(entry).not.toBeNull();
    expect(entry!.status).toBe("posted");
  });

  it("findEntryById returns null for wrong tenant", async () => {
    const entry = await entryRepo.findEntryById(ENTRY_ID, randomUUID());
    expect(entry).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// EWAY-BILL REPO — insertEwayBill + updateEwayBillStatus
// ══════════════════════════════════════════════════════════════════════════════
describe("eway-bill/repo — insertEwayBill + updateEwayBillStatus", () => {
  const EWB_ID = randomUUID();

  afterAll(async () => {
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.delete(ewayBills).where(eq(ewayBills.id, EWB_ID));
    }));
  });

  it("insertEwayBill + updateEwayBillStatus lifecycle", async () => {
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await ewayRepo.insertEwayBill(tx, {
        id: EWB_ID, tenantId: TENANT, supplyType: "outward", subSupplyType: "supply",
        docType: "invoice", docNo: "INV-COV-001", docDate: "2024-06-15",
        fromGstin: "29ABCDE1234F1Z5", fromName: "Org A", fromAddr: "Addr A",
        fromPin: "560001", fromStateCode: "29",
        toName: "Org B", toAddr: "Addr B", toPin: "400001", toStateCode: "27",
        totalValueMinor: 5000000n, hsnCode: "8471",
        transportMode: "road", vehicleNo: "KA01AB1234",
        status: "pending", createdBy: ACTOR, updatedBy: ACTOR,
      });
    }));

    const bill = await ewayRepo.findById(TENANT, EWB_ID);
    expect(bill).toBeDefined();
    expect(bill!.status).toBe("pending");

    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await ewayRepo.updateEwayBillStatus(tx, EWB_ID, TENANT, {
        status: "active", ewbNo: "3210001234567", updatedBy: ACTOR, version: 2,
      });
    }));

    // Invalidate cache so findById fetches fresh data
    const { cache } = await import("../src/shared/infra.js");
    await cache.invalidate(`stock:${TENANT}:eway_bill:${EWB_ID}`);

    const updated = await ewayRepo.findById(TENANT, EWB_ID);
    expect(updated!.status).toBe("active");
    expect(updated!.ewbNo).toBe("3210001234567");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// EWAY-BILL COMMANDS — cancelEwayBill + updateEwayBillVehicle (via route)
// ══════════════════════════════════════════════════════════════════════════════
describe("eway-bill commands — cancel + updateVehicle via live bill", () => {
  const EWB_ID = randomUUID();
  let app: import("fastify").FastifyInstance;

  beforeAll(async () => {
    // Seed an active eway-bill to bypass 404 in pre-checks
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(ewayBills).values({
        id: EWB_ID, tenantId: TENANT, supplyType: "outward", subSupplyType: "supply",
        docType: "invoice", docNo: "INV-CMD-001", docDate: "2024-06-15",
        fromGstin: "29ABCDE1234F1Z5", fromName: "Org A", fromAddr: "Addr A",
        fromPin: "560001", fromStateCode: "29",
        toName: "Org B", toAddr: "Addr B", toPin: "400001", toStateCode: "27",
        totalValueMinor: 5000000n, hsnCode: "8471",
        transportMode: "road", vehicleNo: "KA01AB1234",
        ewbNo: "3210009999999", status: "active",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
    }));
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.delete(ewayBills).where(eq(ewayBills.id, EWB_ID));
    }));
    await sqlClient.end();
  });

  it("PATCH /v1/stock/eway-bills/:id/cancel → 202 for active bill", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/stock/eway-bills/${EWB_ID}/cancel`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { reason: "Goods not dispatched anymore" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("PATCH /v1/stock/eway-bills/:id/update-vehicle → 202 for active bill", async () => {
    // Re-seed as active (cancel test may have queued a status change, but not processed)
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.update(ewayBills).set({ status: "active" }).where(eq(ewayBills.id, EWB_ID));
    }));
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/stock/eway-bills/${EWB_ID}/update-vehicle`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { vehicleNo: "MH04XY5678" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });
});
