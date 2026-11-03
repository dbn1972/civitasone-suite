/**
 * UAT Phase 2 C2 (J2 D1): a PO above Rs 1,000 needs a sanctionRef (#14). POST
 * /pos used to answer 202 for a ₹6,002 PO without one; the worker then dropped
 * it (SANCTION_REF_REQUIRED) and the officer landed on "We couldn't load purchase
 * order". The create routes now refuse it with 422 SANCTION_REF_REQUIRED and
 * enqueue nothing; with a sanctionRef (or at ₹1,000 or less) the PO is accepted.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
process.env.PII_ENC_KEY = process.env.PII_ENC_KEY ?? "test_pii_encryption_key_32chars!!";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { procurementVendors } from "../src/modules/vendor/schema.js";
import { assertSanctionRefPresent, poTotalMinor } from "../src/modules/po/domain.js";

const TENANT = "11111111-eeee-4000-8000-0000000000c2";
const ACTOR = randomUUID();
const SECRET = process.env.JWT_SECRET as string;
const headers = { authorization: `Bearer ${signToken({ sub: "u-c2", tid: TENANT, roles: ["procurement_officer"], sid: "s-c2" }, SECRET)}` };
const VENDOR = randomUUID();
const SANCTION = randomUUID();

function poBody(unitPriceMinor: number, sanctionRef?: string) {
  return {
    vendorId: VENDOR, indentRef: `procurement_indent:${randomUUID()}`,
    gemOrderRef: "GEM/TEST/BASIS",
    ...(sanctionRef ? { sanctionRef } : {}),
    items: [{ itemCode: "L2-ITM-1", description: "Paper", quantity: 4, unit: "nos", unitPriceMinor }],
  };
}

const realFetch = globalThis.fetch;
function workflowConfigured() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("/v1/workflow/internal/definition-configured")) return realFetch(input, init);
    return new Response(JSON.stringify({ code: "procurement_po_approval", configured: true }), { status: 200, headers: { "content-type": "application/json" } });
  });
}

async function clean() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(procurementVendors).where(eq(procurementVendors.tenantId, TENANT));
  }));
}

beforeAll(async () => {
  await clean();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(procurementVendors).values({ id: VENDOR, tenantId: TENANT, name: "C2 Co", vendorType: "registered", createdBy: ACTOR, updatedBy: ACTOR });
  }));
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("C2 assertSanctionRefPresent (pure)", () => {
  it("sums the PO in BigInt paise", () => {
    expect(poTotalMinor([{ quantity: 4, unitPriceMinor: 150050 }])).toBe(600200n);
  });
  it("throws SANCTION_REF_REQUIRED above Rs 1,000 without a ref; passes at Rs 1,000 or with a ref", () => {
    expect(() => assertSanctionRefPresent([{ quantity: 4, unitPriceMinor: 150050 }], undefined)).toThrow(/SANCTION_REF_REQUIRED|sanction/);
    expect(() => assertSanctionRefPresent([{ quantity: 4, unitPriceMinor: 150050 }], "  ")).toThrow();
    expect(() => assertSanctionRefPresent([{ quantity: 1, unitPriceMinor: 100000 }], undefined)).not.toThrow();
    expect(() => assertSanctionRefPresent([{ quantity: 4, unitPriceMinor: 150050 }], `finance_sanction:${SANCTION}`)).not.toThrow();
  });
});

describe("C2 POST create refuses a high-value PO without a sanction reference", () => {
  for (const url of ["/v1/procurement/pos", "/v1/procurement/purchase-orders"]) {
    it(`${url}: ₹6,002 with no sanctionRef -> 422 SANCTION_REF_REQUIRED, nothing enqueued`, async () => {
      workflowConfigured();
      const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url, headers, payload: poBody(150050) });
      await app.close();
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("SANCTION_REF_REQUIRED");
      expect(publish).not.toHaveBeenCalled();
    });

    it(`${url}: ₹6,002 with a sanctionRef -> 202 and the ref is carried on the command`, async () => {
      workflowConfigured();
      const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url, headers, payload: poBody(150050, `finance_sanction:${SANCTION}`) });
      await app.close();
      expect(res.statusCode).toBe(202);
      expect(publish).toHaveBeenCalledTimes(1);
      const payload = (publish.mock.calls[0]?.[1] as { payload: { sanctionRef?: string } }).payload;
      expect(payload.sanctionRef).toBe(`finance_sanction:${SANCTION}`);
    });
  }

  it("₹800 with no sanctionRef is still accepted (202)", async () => {
    workflowConfigured();
    vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/procurement/pos", headers, payload: poBody(20000) });
    await app.close();
    expect(res.statusCode).toBe(202);
  });
});
