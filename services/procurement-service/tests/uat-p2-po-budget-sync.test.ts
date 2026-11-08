/**
 * UAT Phase 2 follow-up: a PO citing a sanction without enough balance was
 * accepted (202) and then dropped by the worker (BUDGET_EXCEEDED). POST /pos
 * and /purchase-orders now ask finance-service (GET /v1/finance/sanctions/:id/
 * available, internal service-account call, outside any transaction) and
 * refuse with 422 BUDGET_EXCEEDED / SANCTION_NOT_FOUND before anything is
 * queued. If finance cannot be asked, the PO falls through to the async path
 * (the consumer re-checks and retries).
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
import { rupeesFromMinor, sanctionIdFromRef } from "../src/modules/po/finance-budget-client.js";
import { seedApprovedIndent } from "./helpers/approved-indent.js";

const TENANT = "11111111-eeee-4000-8000-0000000000b3";
const ACTOR = randomUUID();
const SECRET = process.env.JWT_SECRET as string;
const headers = { authorization: `Bearer ${signToken({ sub: "u-b3", tid: TENANT, roles: ["procurement_officer"], sid: "s-b3" }, SECRET)}` };
const VENDOR = randomUUID();
const SANCTION = randomUUID();

const body = (unitPriceMinor: number) => ({
  vendorId: VENDOR, indentRef: INDENT_REF, gemOrderRef: "GEM/TEST/BASIS",
  sanctionRef: `finance_sanction:${SANCTION}`,
  items: [{ itemCode: "L2-ITM-1", description: "Paper", quantity: 4, unit: "nos", unitPriceMinor }],
});

type Answer = { status: number; available?: string } | "down";
function stubServices(finance: Answer) {
  const asked: Array<{ url: string; headers: Headers }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/v1/workflow/internal/definition-configured")) {
      return new Response(JSON.stringify({ code: "procurement_po_approval", configured: true }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/v1/finance/sanctions/")) {
      asked.push({ url, headers: new Headers(init?.headers) });
      if (finance === "down") throw new TypeError("fetch failed");
      return new Response(JSON.stringify(finance.available !== undefined ? { id: SANCTION, available: finance.available, currency: "INR" } : { code: "NOT_FOUND" }), { status: finance.status, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 404 });
  });
  return asked;
}

async function clean() {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.delete(procurementVendors).where(eq(procurementVendors.tenantId, TENANT))));
}
// UAT T-EDGE b21 (TE-04 P08): a PO must cite a real approved indent, checked before 202.
let INDENT_REF = "";
beforeAll(async () => { INDENT_REF = await seedApprovedIndent(TENANT); });
beforeAll(async () => {
  await clean();
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(procurementVendors).values({ id: VENDOR, tenantId: TENANT, name: "B3 Co", vendorType: "registered", createdBy: ACTOR, updatedBy: ACTOR })));
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await clean(); await sqlClient.end(); });

async function post(url: string, unitPriceMinor: number) {
  const app = await buildApp();
  const res = await app.inject({ method: "POST", url, headers, payload: body(unitPriceMinor) });
  await app.close();
  return res;
}

describe("finance-budget-client helpers", () => {
  it("reads the sanction id from the ref and formats paise as rupees", () => {
    expect(sanctionIdFromRef(`finance_sanction:${SANCTION}`)).toBe(SANCTION);
    expect(sanctionIdFromRef(SANCTION)).toBe(SANCTION);
    expect(rupeesFromMinor(600200n)).toBe("₹6,002.00");
    expect(rupeesFromMinor(1234567890n)).toBe("₹1,23,45,678.90");
  });
});

describe("POST create: synchronous sanction-balance check", () => {
  for (const url of ["/v1/procurement/pos", "/v1/procurement/purchase-orders"]) {
    it(`${url}: ₹6,002 against ₹5,000 available -> 422 BUDGET_EXCEEDED (readable), nothing queued`, async () => {
      const asked = stubServices({ status: 200, available: "500000" });
      const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      const res = await post(url, 150050);
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("BUDGET_EXCEEDED");
      expect(res.json().message).toContain("₹6,002.00");
      expect(res.json().message).toContain("₹5,000.00");
      expect(publish).not.toHaveBeenCalled();
      expect(asked).toHaveLength(1);
      expect(asked[0]!.url).toContain(`/v1/finance/sanctions/${SANCTION}/available`);
      expect(asked[0]!.headers.get("x-internal")).toBe("1");
      expect(asked[0]!.headers.get("x-tenant-id")).toBe(TENANT);
    });

    it(`${url}: enough balance -> 202 and the command is queued`, async () => {
      stubServices({ status: 200, available: "600200" });
      const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      const res = await post(url, 150050);
      expect(res.statusCode).toBe(202);
      expect(publish).toHaveBeenCalledTimes(1);
    });
  }

  it("unknown sanction (finance 404) -> 422 SANCTION_NOT_FOUND, nothing queued", async () => {
    stubServices({ status: 404 });
    const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const res = await post("/v1/procurement/pos", 150050);
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("SANCTION_NOT_FOUND");
    expect(publish).not.toHaveBeenCalled();
  });

  it("finance unreachable -> accepted on the async path, with a warn log naming the PO id and reason only", async () => {
    stubServices("down");
    const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const lines: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
      lines.push(String(chunk));
      return (write as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof process.stdout.write);
    const res = await post("/v1/procurement/pos", 150050);
    spy.mockRestore();
    expect(res.statusCode).toBe(202);
    expect(publish).toHaveBeenCalledTimes(1);
    const warn = lines.map((l) => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; } })
      .find((l) => l?.msg === "po budget pre-check skipped: finance-service unavailable");
    expect(warn).toBeTruthy();
    expect(warn!.level).toBe(40);
    expect(warn!.poId).toBe(res.json().id);
    expect(String(warn!.reason)).toContain("finance-service unreachable");
    // No PO content (vendor, amounts, items) in the log line.
    expect(JSON.stringify(warn)).not.toContain(VENDOR);
    expect(JSON.stringify(warn)).not.toContain("150050");
  });

  it("a PO of ₹1,000 or less with no sanction does not call finance", async () => {
    const asked = stubServices({ status: 200, available: "0" });
    vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const app = await buildApp();
    const { sanctionRef: _s, ...noSanction } = body(20000);
    void _s;
    const res = await app.inject({ method: "POST", url: "/v1/procurement/pos", headers, payload: noSanction });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(asked).toHaveLength(0);
  });
});
