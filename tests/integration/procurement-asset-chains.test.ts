/**
 * 10-T2 — Integration chain #2: procurement (fixed-asset GRN) → asset
 *   capitalization → GL.
 *
 *   procurement.grn.accepted  → asset-service register consumer:
 *       (a) inserts an asset register row for every fixed_asset line, and
 *       (b) emits a balanced acquisition GL (finance.gl.post):
 *               Dr 1200 Fixed Asset / Cr 2070 GRN-Clearing
 *           with a deterministic UUIDv5 journal id.
 *
 * AUDIT RESULT (no new mechanism added): the hop was already fully wired —
 * procurement `grn/consumer.ts` emits `procurement.grn.accepted` with
 * `items[]` carrying `{ itemCode, itemName, acceptedQty, rateMinor, currency,
 * itemType }`, and asset `register/consumer.ts` already subscribes, filters
 * `itemType === "fixed_asset"`, registers the asset and posts the acquisition
 * GL. The ONLY change made was an idempotency fix in that EXISTING consumer:
 * the asset id and inbox-dedupe id were `randomUUID()` per delivery, so a
 * redelivered GRN silently double-capitalized (duplicate asset + duplicate GL).
 * They are now derived deterministically from the stable line identity
 * (grnId + itemCode) so redelivery is gated by markProcessed — one asset, one
 * journal. This test publishes the REAL producer event onto a shared bus, wires
 * the REAL asset consumer, and asserts the asset insert, the balanced GL emit,
 * and idempotency on redelivery.
 *
 * DB + outbox + cache are stubbed in-memory so it runs in CI with no Postgres.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ChainHarness, setCurrentHarness } from "./harness.js";

// --- asset-service data layer (downstream consumer) ------------------------
vi.mock("../../services/asset-service/src/shared/db.js", async () => {
  const h = await import("./harness.js");
  return { db: h.mockDb, sqlClient: {} };
});

vi.mock("../../services/asset-service/src/shared/outbox.js", async () => {
  const h = await import("./harness.js");
  return {
    enqueue: h.mockEnqueue,
    markProcessed: h.mockMarkProcessed,
    outboxMessages: {},
    processed: {},
    outboxSchema: {},
    relayOnce: async () => 0,
    startRelay: () => ({}) as unknown,
  };
});

// cache.* runs outside the tx — stub it so no Redis is needed.
vi.mock("../../services/asset-service/src/shared/infra.js", () => ({
  cache: {
    invalidate: async () => {},
    invalidateResource: async () => {},
    makeKey: (...parts: string[]) => parts.join(":"),
  },
}));

// Imported AFTER the mocks are declared (vi.mock is hoisted above imports).
const { registerRegisterConsumers } = await import(
  "../../services/asset-service/src/modules/register/consumer.js"
);

const TENANT = "11111111-aaaa-4000-8000-000000000002";
const ACTOR = "22222222-bbbb-4000-8000-000000000002";
const FIXED_ASSET_CODE = "1200";
const GRN_CLEARING_CODE = "2070";

function envelope(messageId: string, type: string, payload: Record<string, unknown>) {
  return {
    messageId,
    type,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: `corr-${messageId.slice(0, 8)}`,
    schemaVersion: "1.0",
    payload,
  };
}

/**
 * The producer payload procurement `grn/consumer.ts` emits on an accepted GRN:
 * one fixed_asset line (a laptop) and one consumable line (to prove the
 * consumer capitalizes ONLY the fixed_asset line).
 */
function grnAcceptedPayload(grnId: string) {
  return {
    grnId,
    poRef: "procurement_po:PO-2026-00099",
    vendorId: "ddddffff-0001-4000-8000-000000000002",
    grossMinor: 1500000,
    items: [
      {
        itemCode: "FA-LAPTOP-01",
        itemName: "Dell Latitude Laptop",
        acceptedQty: 3,
        rateMinor: 500000, // 5,000.00 each -> 15,000.00 total
        currency: "INR",
        itemType: "fixed_asset",
        itemId: "po-item-fa-1",
      },
      {
        itemCode: "CONS-PAPER-01",
        itemName: "A4 Paper Ream",
        acceptedQty: 100,
        rateMinor: 25000,
        currency: "INR",
        itemType: "consumable",
        itemId: "po-item-cons-1",
      },
    ],
  };
}

const EXPECTED_TOTAL_MINOR = 500000n * 3n; // 1,500,000 paise

let harness: ChainHarness;

beforeEach(async () => {
  harness = new ChainHarness();
  setCurrentHarness(harness);
  registerRegisterConsumers(harness.queue);
  await harness.queue.start();
});

afterEach(async () => {
  await harness.queue.stop();
  setCurrentHarness(null);
});

describe("Chain #2: procurement.grn.accepted → asset capitalization → GL", () => {
  it("an accepted fixed-asset GRN registers the asset and posts a balanced acquisition GL (Dr 1200 / Cr 2070)", async () => {
    const glPost = harness.nextEvent("finance.gl.post");
    const grnId = "abcd1234-0011-4000-8000-000000000001";

    await harness.queue.publish(
      "procurement.grn.accepted",
      envelope("eeee0001-0011-4000-8000-000000000001", "procurement.grn.accepted", grnAcceptedPayload(grnId)),
    );

    const msg = await glPost;

    // --- (a) the asset register row was written (and ONLY for the FA line) ---
    const assetRows = harness.inserts.filter((i) => i.table.includes("asset_assets"));
    expect(assetRows).toHaveLength(1);
    const asset = assetRows[0]!.row as Record<string, unknown>;
    expect(asset.tenantId).toBe(TENANT);
    expect(asset.code).toBe("FA-LAPTOP-01");
    expect(asset.name).toBe("Dell Latitude Laptop");
    expect(asset.assetType).toBe("fixed");
    expect(asset.status).toBe("active");
    expect(asset.acquisitionCost).toBe(EXPECTED_TOTAL_MINOR);
    expect(asset.bookValue).toBe(EXPECTED_TOTAL_MINOR);
    expect(asset.grnRef).toBe(`procurement_grn:${grnId}`);
    expect(asset.poRef).toBe("procurement_po:PO-2026-00099");
    expect(asset.createdBy).toBe(ACTOR);

    // --- (b) a balanced acquisition GL post: Dr 1200 / Cr 2070 ---------------
    expect(msg.type).toBe("finance.gl.post");
    const gl = msg.payload as {
      id: string;
      tenantId: string;
      type: string;
      postingDate: string;
      voucherNo: string;
      lines: Array<{ accountCode: string; debitMinor: string; creditMinor: string }>;
    };
    expect(gl.tenantId).toBe(TENANT);
    expect(gl.type).toBe("asset_acquisition");
    expect(typeof gl.id).toBe("string");
    // valid RFC-4122 uuid (uuidV5) — finance casts into a uuid column.
    expect(gl.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    const debit = gl.lines.find((l) => l.accountCode === FIXED_ASSET_CODE);
    const credit = gl.lines.find((l) => l.accountCode === GRN_CLEARING_CODE);
    expect(debit).toBeDefined();
    expect(credit).toBeDefined();
    expect(debit!.debitMinor).toBe(EXPECTED_TOTAL_MINOR.toString());
    expect(debit!.creditMinor).toBe("0");
    expect(credit!.creditMinor).toBe(EXPECTED_TOTAL_MINOR.toString());
    expect(credit!.debitMinor).toBe("0");

    // Balanced: sum(debit) === sum(credit).
    const sumDr = gl.lines.reduce((a, l) => a + BigInt(l.debitMinor), 0n);
    const sumCr = gl.lines.reduce((a, l) => a + BigInt(l.creditMinor), 0n);
    expect(sumDr).toBe(sumCr);
    expect(sumDr).toBe(EXPECTED_TOTAL_MINOR);
  });

  it("a redelivered GRN event is processed once — one asset, one journal (idempotency)", async () => {
    const glPosts: string[] = [];
    harness.queue.subscribe("finance.gl.post", async () => {
      glPosts.push("posted");
    });

    const grnId = "abcd1234-0012-4000-8000-000000000001";
    const dup = envelope("eeee0002-0012-4000-8000-000000000001", "procurement.grn.accepted", grnAcceptedPayload(grnId));

    await harness.queue.publish("procurement.grn.accepted", dup);
    await harness.queue.publish("procurement.grn.accepted", dup);
    await new Promise((r) => setTimeout(r, 300));

    // Deterministic per-line dedupe id (uuidV5 of grnId+itemCode) gates the
    // second delivery: exactly one asset row and one GL post.
    const assetRows = harness.inserts.filter((i) => i.table.includes("asset_assets"));
    expect(assetRows).toHaveLength(1);
    expect(glPosts).toHaveLength(1);
  });

  it("a GRN with no fixed_asset lines registers nothing and posts no GL", async () => {
    const glPosts: string[] = [];
    harness.queue.subscribe("finance.gl.post", async () => {
      glPosts.push("posted");
    });

    await harness.queue.publish(
      "procurement.grn.accepted",
      envelope("eeee0003-0013-4000-8000-000000000001", "procurement.grn.accepted", {
        grnId: "abcd1234-0013-4000-8000-000000000001",
        poRef: "procurement_po:PO-X",
        vendorId: "ddddffff-0003-4000-8000-000000000002",
        grossMinor: 25000,
        items: [
          { itemCode: "CONS-PEN-01", itemName: "Pen", acceptedQty: 10, rateMinor: 2500, currency: "INR", itemType: "consumable" },
        ],
      }),
    );
    await new Promise((r) => setTimeout(r, 200));

    const assetRows = harness.inserts.filter((i) => i.table.includes("asset_assets"));
    expect(assetRows).toHaveLength(0);
    expect(glPosts).toHaveLength(0);
  });
});
