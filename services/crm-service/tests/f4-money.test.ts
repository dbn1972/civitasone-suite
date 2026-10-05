/**
 * F4 money follow-ups — DB-backed.
 *
 * F4-01 Quotation totals: total_minor stays NET; tax_minor + grand_total_minor are
 *       computed server-side per line (round(net*bps/10000), round-half-up) and returned
 *       as netMinor / taxMinor / grandTotalMinor. An order from a quotation carries the
 *       grand total. BigInt throughout — a multi-line sum has no float.
 * F4-02 HSN/SAC + GST split: products carry an optional hsn_sac (4-8 digits); a quotation
 *       carries place_of_supply + supplier_state. Per line: intra-state → CGST = SGST =
 *       tax/2 (odd paisa to SGST); inter-state → IGST = tax.
 * F4-03 Multi-currency catalogue: products/price-books take a currency from the allow-list
 *       (INR/USD/EUR/GBP/AED); a quotation is single-currency — a line sourced from a
 *       product in another currency is rejected with 422 CURRENCY_MISMATCH.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";
import {
  computeTotals,
  lineTaxMinor,
  gstSplit,
  isAllowedCurrency,
  ALLOWED_CURRENCIES,
} from "../src/modules/deals/quotation-domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000f4";
const ACTOR = "cccccccc-3333-4000-8000-0000000000f4";

let refCounter = 0;
function nextRef(prefix: string): string {
  refCounter += 1;
  return `${prefix}-${refCounter}`;
}

function token(roles = ["crm_admin"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-f4" }, SECRET);
}
function headers(roles = ["crm_admin"]) {
  return { authorization: `Bearer ${token(roles)}`, "x-tenant-id": TENANT };
}

async function cleanup(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.orders WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.quotation_line_items WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.quotations WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.products WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  registerAllConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await drainQueue();
  await cleanup();
  await sqlClient.end();
});

async function post(url: string, payload: Record<string, unknown>, roles = ["crm_admin"]) {
  const app = await buildApp();
  const res = await app.inject({ method: "POST", url, headers: headers(roles), payload });
  await app.close();
  await drainQueue();
  return res;
}

async function get(url: string, roles = ["crm_admin"]) {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url, headers: headers(roles) });
  await app.close();
  return res;
}

async function createProduct(payload: Record<string, unknown>): Promise<string> {
  const res = await post("/v1/crm/products", { enabled: true, ...payload });
  expect(res.statusCode, res.body).toBe(202);
  const list = await get("/v1/crm/products?limit=200");
  const row = list.json().data.find((p: { code: string }) => p.code === payload.code);
  expect(row, `product ${String(payload.code)} not applied`).toBeDefined();
  return row.id as string;
}

async function createQuote(payload: Record<string, unknown>, roles = ["crm_admin"]) {
  return post("/v1/crm/quotations", payload, roles);
}

async function fetchQuote(id: string): Promise<Record<string, unknown>> {
  const res = await get("/v1/crm/quotations?limit=200");
  const row = res.json().data.find((q: { id: string }) => q.id === id);
  expect(row, `quotation ${id} not applied`).toBeDefined();
  return row;
}

async function fetchDocument(id: string): Promise<Record<string, unknown>> {
  const res = await get(`/v1/crm/quotations/${id}/document`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().data;
}

/* =============================================================== pure maths == */

describe("F4-01 quotation totals (pure)", () => {
  it("18% tax on a line gives the correct paise, round-half-up", () => {
    expect(lineTaxMinor({ description: "x", quantity: 1, unitPriceMinor: "100000", taxRateBps: 1800 })).toBe(18000n);
  });

  it("rounds tax half-up, not down", () => {
    expect(lineTaxMinor({ description: "x", quantity: 1, unitPriceMinor: "101", taxRateBps: 1800 })).toBe(18n);
    expect(lineTaxMinor({ description: "x", quantity: 1, unitPriceMinor: "3", taxRateBps: 1800 })).toBe(1n);
  });

  it("a multi-line sum stays exact above 2^53 with no float", () => {
    const t = computeTotals([
      { description: "Licences", quantity: 1_000_000, unitPriceMinor: "9007199254", taxRateBps: 1800 },
      { description: "Support", quantity: 1, unitPriceMinor: "1", taxRateBps: 0 },
    ]);
    expect(t.netMinor).toBe(9_007_199_254_000_000n + 1n);
    expect(t.taxMinor).toBe(1_621_295_865_720_000n);
    expect(t.grandTotalMinor).toBe(t.netMinor + t.taxMinor);
  });

  it("zero-tax lines contribute no tax", () => {
    const t = computeTotals([{ description: "x", quantity: 2, unitPriceMinor: "5000" }]);
    expect(t.netMinor).toBe(10000n);
    expect(t.taxMinor).toBe(0n);
    expect(t.grandTotalMinor).toBe(10000n);
  });
});

describe("F4-02 GST split (pure)", () => {
  it("intra-state splits tax into CGST = SGST = tax/2, odd paisa to SGST", () => {
    const even = gstSplit(18000n, "27", "27");
    expect(even).toEqual({ cgstMinor: 9000n, sgstMinor: 9000n, igstMinor: 0n });
    const odd = gstSplit(18001n, "27", "27");
    expect(odd.cgstMinor).toBe(9000n);
    expect(odd.sgstMinor).toBe(9001n);
    expect(odd.cgstMinor + odd.sgstMinor).toBe(18001n);
    expect(odd.igstMinor).toBe(0n);
  });

  it("inter-state puts all tax in IGST", () => {
    expect(gstSplit(18000n, "27", "07")).toEqual({ cgstMinor: 0n, sgstMinor: 0n, igstMinor: 18000n });
  });

  it("unknown place/supplier is treated as inter-state (IGST)", () => {
    expect(gstSplit(500n, null, "27").igstMinor).toBe(500n);
    expect(gstSplit(500n, "27", null).igstMinor).toBe(500n);
  });

  it("zero tax yields no split", () => {
    expect(gstSplit(0n, "27", "27")).toEqual({ cgstMinor: 0n, sgstMinor: 0n, igstMinor: 0n });
  });
});

describe("F4-03 currency allow-list (pure)", () => {
  it("accepts the allow-list only", () => {
    for (const c of ALLOWED_CURRENCIES) expect(isAllowedCurrency(c)).toBe(true);
    expect(isAllowedCurrency("inr")).toBe(true);
    expect(isAllowedCurrency("JPY")).toBe(false);
    expect(isAllowedCurrency("ZZZ")).toBe(false);
  });
});

/* ============================================================== HTTP + DB == */

describe("F4-01 quotation tax totals (DB)", () => {
  it("returns netMinor/taxMinor/grandTotalMinor, net excludes tax", async () => {
    const created = await createQuote({
      quoteRef: nextRef("Q-TAX"),
      templateRef: "tpl",
      lineItems: [
        { description: "Platform", quantity: 10, unitPriceMinor: "500000", taxRateBps: 1800 },
        { description: "Onboarding", quantity: 1, unitPriceMinor: "150000", taxRateBps: 1800 },
      ],
    });
    expect(created.statusCode, created.body).toBe(202);
    const row = await fetchQuote(created.json().id);
    expect(row.netMinor).toBe("5150000");
    expect(row.totalMinor).toBe("5150000");
    expect(row.taxMinor).toBe("927000");
    expect(row.grandTotalMinor).toBe("6077000");
    expect(typeof row.grandTotalMinor).toBe("string");
  });

  it("an order created from an accepted quotation carries the grand total", async () => {
    const created = await createQuote({
      quoteRef: nextRef("Q-ORD"),
      templateRef: "tpl",
      lineItems: [{ description: "Item", quantity: 1, unitPriceMinor: "100000", taxRateBps: 1800 }],
    });
    const id = created.json().id;
    expect((await post(`/v1/crm/quotations/${id}/send`, {})).statusCode).toBe(202);
    expect((await post(`/v1/crm/quotations/${id}/accept`, {})).statusCode).toBe(202);
    const convert = await post(`/v1/crm/quotations/${id}/convert-to-order`, {});
    expect(convert.statusCode, convert.body).toBe(202);

    const order = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      return tx`SELECT total_minor::text AS "totalMinor", grand_total_minor::text AS "grandTotalMinor"
                FROM crm.orders WHERE tenant_id = ${TENANT} AND quotation_id = ${id}`;
    }) as unknown as Array<{ totalMinor: string; grandTotalMinor: string }>;
    expect(order[0]?.totalMinor).toBe("100000");
    expect(order[0]?.grandTotalMinor).toBe("118000");
  });
});

describe("F4-02 HSN/SAC + GST split (DB)", () => {
  it("stores a product's hsn_sac and returns it", async () => {
    const code = nextRef("HSN");
    await createProduct({ code, name: "Service", unit: "unit", taxRateBps: 1800, priceMinor: "100000", hsnSac: "998314" });
    const list = await get("/v1/crm/products?limit=200");
    const row = list.json().data.find((p: { code: string }) => p.code === code);
    expect(row.hsnSac).toBe("998314");
  });

  it("rejects a bad hsn_sac (too short / non-digit) -> 400", async () => {
    const r1 = await post("/v1/crm/products", { code: nextRef("BADHSN"), name: "x", hsnSac: "12" });
    expect(r1.statusCode).toBe(400);
    const r2 = await post("/v1/crm/products", { code: nextRef("BADHSN"), name: "x", hsnSac: "99A8" });
    expect(r2.statusCode).toBe(400);
  });

  it("intra-state quotation document splits CGST/SGST per line", async () => {
    const created = await createQuote({
      quoteRef: nextRef("Q-INTRA"),
      templateRef: "tpl",
      placeOfSupply: "27",
      supplierState: "27",
      lineItems: [{ description: "Item", quantity: 1, unitPriceMinor: "100000", taxRateBps: 1800 }],
    });
    const doc = await fetchDocument(created.json().id);
    expect(doc.placeOfSupply).toBe("27");
    const line = (doc.lineItems as Array<Record<string, string>>)[0];
    expect(line.taxMinor).toBe("18000");
    expect(line.cgstMinor).toBe("9000");
    expect(line.sgstMinor).toBe("9000");
    expect(line.igstMinor).toBe("0");
    expect(doc.gstSummary).toEqual({ cgstMinor: "9000", sgstMinor: "9000", igstMinor: "0" });
  });

  it("inter-state quotation document puts tax in IGST", async () => {
    const created = await createQuote({
      quoteRef: nextRef("Q-INTER"),
      templateRef: "tpl",
      placeOfSupply: "27",
      supplierState: "07",
      lineItems: [{ description: "Item", quantity: 1, unitPriceMinor: "100000", taxRateBps: 1800 }],
    });
    const doc = await fetchDocument(created.json().id);
    const line = (doc.lineItems as Array<Record<string, string>>)[0];
    expect(line.igstMinor).toBe("18000");
    expect(line.cgstMinor).toBe("0");
    expect(doc.gstSummary).toEqual({ cgstMinor: "0", sgstMinor: "0", igstMinor: "18000" });
  });
});

describe("F4-03 multi-currency catalogue (DB)", () => {
  it("stores a USD product and surfaces its currency", async () => {
    const code = nextRef("USD");
    await createProduct({ code, name: "Export licence", unit: "unit", priceMinor: "5000", currency: "USD" });
    const list = await get("/v1/crm/products?limit=200");
    const row = list.json().data.find((p: { code: string }) => p.code === code);
    expect(row.currency).toBe("USD");
  });

  it("rejects a product in a currency outside the allow-list -> 400", async () => {
    const res = await post("/v1/crm/products", { code: nextRef("JPY"), name: "x", priceMinor: "100", currency: "JPY" });
    expect(res.statusCode).toBe(400);
  });

  it("rejects adding a foreign-currency product line to an INR quotation -> 422", async () => {
    const usdId = await createProduct({ code: nextRef("USDLINE"), name: "USD item", priceMinor: "5000", currency: "USD" });
    const res = await createQuote({
      quoteRef: nextRef("Q-CUR"),
      templateRef: "tpl",
      currency: "INR",
      lineItems: [{ productId: usdId, description: "USD item", quantity: 1, unitPriceMinor: "5000" }],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("CURRENCY_MISMATCH");
  });

  it("allows a matching-currency line (USD product on a USD quotation)", async () => {
    const usdId = await createProduct({ code: nextRef("USDOK"), name: "USD ok", priceMinor: "5000", currency: "USD" });
    const res = await createQuote({
      quoteRef: nextRef("Q-USD"),
      templateRef: "tpl",
      currency: "USD",
      lineItems: [{ productId: usdId, description: "USD ok", quantity: 2, unitPriceMinor: "5000", taxRateBps: 0 }],
    });
    expect(res.statusCode, res.body).toBe(202);
    const row = await fetchQuote(res.json().id);
    expect(row.currency).toBe("USD");
    expect(row.netMinor).toBe("10000");
  });
});
