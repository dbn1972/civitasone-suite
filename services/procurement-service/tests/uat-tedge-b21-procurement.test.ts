/**
 * UAT T-EDGE bundle 21 -- procurement forms (indent, PO, GRN).
 *
 * TE-01 / TE-07: impossible, free-text and implausible dates are refused SYNCHRONOUSLY with a field
 * code (they used to be 202-accepted and dropped by the worker, or stored: GRN "yesterday").
 * TE-06: whitespace-only purpose refused. TE-01 I12: a 1e19 unit price refused.
 * TE-04: a PO citing an indent that does not exist is a 422 on indentRef; accepted > received is a
 * 400 on acceptedQty. TE-09: X-Idempotency-Key -- the same key + body creates ONE indent and the
 * retry gets the first answer; the same key with another body is a 422; a repeat without a key
 * in the same minute gets a POSSIBLE_DUPLICATE warning.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
process.env.PII_ENC_KEY = process.env.PII_ENC_KEY ?? "test_pii_encryption_key_32chars!!";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { procurementVendors } from "../src/modules/vendor/schema.js";
import { procurementIndents } from "../src/modules/indent/schema.js";
import { istToday, addYears, addDays } from "@civitasone/schemas/validators";

const TENANT = "11111111-eeee-4000-8000-000000000b21";
const ACTOR = randomUUID();
const SECRET = process.env.JWT_SECRET as string;
const token = signToken({ sub: ACTOR, tid: TENANT, roles: ["procurement_officer"], sid: "s-b21" }, SECRET);
const headers = { authorization: `Bearer ${token}` };
const VENDOR = randomUUID();
const INDENT = randomUUID();
const today = istToday();

let app: FastifyInstance;
const realFetch = globalThis.fetch;
function workflowConfigured() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("/v1/workflow/internal/definition-configured")) return realFetch(input, init);
    return new Response(JSON.stringify({ code: "procurement_po_approval", configured: true }), { status: 200, headers: { "content-type": "application/json" } });
  });
}

function indentBody(over: Record<string, unknown> = {}) {
  return {
    department: "Stores", purpose: `UAT-TEDGE b21 indent ${randomUUID()}`, requiredBy: addDays(today, 30),
    items: [{ itemCode: "B21-1", description: "Paper", quantity: 2, unit: "nos", unitPriceMinor: 40000 }],
    ...over,
  };
}
function poBody(over: Record<string, unknown> = {}) {
  return {
    vendorId: VENDOR, indentRef: `procurement_indent:${INDENT}`, gemOrderRef: "GEM/TEST/BASIS",
    items: [{ itemCode: "B21-1", description: "Paper", quantity: 1, unit: "nos", unitPriceMinor: 50000 }],
    ...over,
  };
}
type Body = { code?: string; fieldErrors?: Array<{ field: string; code?: string }>; id?: string; warnings?: Array<{ code: string }> };
const fieldCode = (b: Body, field: string) => b.fieldErrors?.find((f) => f.field === field)?.code;

async function clean() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(procurementVendors).where(eq(procurementVendors.tenantId, TENANT));
    await tx.delete(procurementIndents).where(eq(procurementIndents.tenantId, TENANT));
  }));
}

beforeAll(async () => {
  await clean();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(procurementVendors).values({ id: VENDOR, tenantId: TENANT, name: "B21 Co", vendorType: "registered", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(procurementIndents).values({
      id: INDENT, tenantId: TENANT, indentNo: "IND/B21/0001", department: "Stores", purpose: "b21 control",
      totalMinor: 80000n, committedMinor: 0n, status: "approved", createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
  app = await buildApp();
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await app.close(); await clean(); await sqlClient.end(); });

describe("indent create -- dates, text and amounts are refused at the route (TE-01/06/07)", () => {
  it.each([
    ["2027-02-29", "DATE_INVALID"], ["2026-04-31", "DATE_INVALID"], ["next week", "DATE_INVALID"],
    ["2020-01-01", "DATE_TOO_EARLY"], [addYears(today, 4), "DATE_TOO_LATE"],
  ])("required-by %s -> 400 %s, nothing queued", async (requiredBy, code) => {
    const publish = vi.spyOn(queue, "publish");
    const res = await app.inject({ method: "POST", url: "/v1/procurement/indents", headers, payload: indentBody({ requiredBy }) });
    expect(res.statusCode).toBe(400);
    expect(fieldCode(res.json(), "requiredBy")).toBe(code);
    expect(publish).not.toHaveBeenCalled();
  });
  it("purpose of five spaces -> 400 TEXT_BLANK (I13)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/procurement/indents", headers, payload: indentBody({ purpose: "     " }) });
    expect(res.statusCode).toBe(400);
    expect(fieldCode(res.json(), "purpose")).toBe("TEXT_BLANK");
  });
  it("unit price 1e19 -> 400 AMOUNT_TOO_LARGE (I12), not a 202 + worker drop", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/procurement/indents", headers, payload: indentBody({ items: [{ itemCode: "X", description: "Y", quantity: 1, unit: "nos", unitPriceMinor: 1e19 }] }) });
    expect(res.statusCode).toBe(400);
    expect(fieldCode(res.json(), "items.0.unitPriceMinor")).toBe("AMOUNT_TOO_LARGE");
  });
  it("a valid indent is accepted with the purpose trimmed", async () => {
    const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const res = await app.inject({ method: "POST", url: "/v1/procurement/indents", headers, payload: indentBody({ purpose: "  Printer paper for the registry  " }) });
    expect(res.statusCode).toBe(202);
    const payload = (publish.mock.calls[0]![1] as { payload: { purpose: string } }).payload;
    expect(payload.purpose).toBe("Printer paper for the registry");
  });
});

describe("indent create -- X-Idempotency-Key (TE-09)", () => {
  it("the same key + body twice (also in parallel) queues ONE indent and returns the same answer", async () => {
    const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const key = `b21-${randomUUID()}`;
    const body = indentBody();
    const h = { ...headers, "x-idempotency-key": key };
    const [a, b] = await Promise.all([
      app.inject({ method: "POST", url: "/v1/procurement/indents", headers: h, payload: body }),
      app.inject({ method: "POST", url: "/v1/procurement/indents", headers: h, payload: body }),
    ]);
    const c = await app.inject({ method: "POST", url: "/v1/procurement/indents", headers: h, payload: body });
    expect([a.statusCode, b.statusCode, c.statusCode]).toEqual([202, 202, 202]);
    expect(new Set([a.json().id, b.json().id, c.json().id]).size).toBe(1);
    expect(publish).toHaveBeenCalledTimes(1);
  });
  it("the same key with a different body -> 422 IDEMPOTENCY_KEY_REUSED", async () => {
    vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const h = { ...headers, "x-idempotency-key": `b21-${randomUUID()}` };
    const first = await app.inject({ method: "POST", url: "/v1/procurement/indents", headers: h, payload: indentBody() });
    const second = await app.inject({ method: "POST", url: "/v1/procurement/indents", headers: h, payload: indentBody() });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(422);
    expect(second.json().code).toBe("IDEMPOTENCY_KEY_REUSED");
  });
  it("a repeat without a key (same maker, purpose, items, minute) is accepted with a POSSIBLE_DUPLICATE warning", async () => {
    vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const body = indentBody();
    const first = await app.inject({ method: "POST", url: "/v1/procurement/indents", headers, payload: body });
    const second = await app.inject({ method: "POST", url: "/v1/procurement/indents", headers, payload: body });
    expect(first.statusCode).toBe(202);
    expect(first.json().warnings).toBeUndefined();
    expect(second.statusCode).toBe(202);
    expect(second.json().warnings?.[0]?.code).toBe("POSSIBLE_DUPLICATE");
    expect(second.json().id).not.toBe(first.json().id);
  });
});

describe("PO create -- delivery date and the cited indent (TE-01/04/07)", () => {
  it.each([["2027-02-29", "DATE_INVALID"], ["31/04/2027", "DATE_INVALID"], ["2001-01-01", "DATE_TOO_EARLY"]])("delivery %s -> 400 %s", async (deliveryDate, code) => {
    const res = await app.inject({ method: "POST", url: "/v1/procurement/purchase-orders", headers, payload: poBody({ deliveryDate }) });
    expect(res.statusCode).toBe(400);
    expect(fieldCode(res.json(), "deliveryDate")).toBe(code);
  });
  it.each(["/v1/procurement/pos", "/v1/procurement/purchase-orders"])("%s: an indent that does not exist -> 422 INDENT_NOT_FOUND on indentRef, nothing queued (P08)", async (url) => {
    workflowConfigured();
    const publish = vi.spyOn(queue, "publish");
    const res = await app.inject({ method: "POST", url, headers, payload: poBody({ indentRef: `procurement_indent:${randomUUID()}` }) });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INDENT_NOT_FOUND");
    expect(fieldCode(res.json(), "indentRef")).toBe("INDENT_NOT_FOUND");
    expect(publish).not.toHaveBeenCalled();
  });
  it("more than the indent still allows -> 422 INDENT_BUDGET_EXCEEDED", async () => {
    workflowConfigured();
    const res = await app.inject({ method: "POST", url: "/v1/procurement/purchase-orders", headers, payload: poBody({ items: [{ itemCode: "B21-1", description: "Paper", quantity: 2, unit: "nos", unitPriceMinor: 50000 }] }) });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INDENT_BUDGET_EXCEEDED");
  });
  it("a valid PO against the approved indent is accepted; the same key replays it", async () => {
    workflowConfigured();
    const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const h = { ...headers, "x-idempotency-key": `b21-${randomUUID()}` };
    const body = poBody({ deliveryDate: addDays(today, 10) });
    const a = await app.inject({ method: "POST", url: "/v1/procurement/purchase-orders", headers: h, payload: body });
    const b = await app.inject({ method: "POST", url: "/v1/procurement/purchase-orders", headers: h, payload: body });
    expect([a.statusCode, b.statusCode]).toEqual([202, 202]);
    expect(b.json().id).toBe(a.json().id);
    expect(publish.mock.calls.filter((c) => String(c[0]).includes("po")).length).toBe(1);
  });
});

describe("GRN create -- received date and quantities (TE-01/04/07)", () => {
  const grn = (over: Record<string, unknown> = {}, item: Record<string, unknown> = {}) => ({
    poRef: `procurement_po:${randomUUID()}`, vendorId: VENDOR,
    items: [{ poItemRef: randomUUID(), itemCode: "B21-1", orderedQty: 2, receivedQty: 2, acceptedQty: 2, unit: "nos", ...item }],
    ...over,
  });
  it.each([["2026-02-30", "DATE_INVALID"], ["yesterday", "DATE_INVALID"], ["2030-01-01", "DATE_TOO_LATE"], [addYears(today, -2), "DATE_TOO_EARLY"]])("received %s -> 400 %s", async (receivedDate, code) => {
    const res = await app.inject({ method: "POST", url: "/v1/procurement/grns", headers, payload: grn({ receivedDate }) });
    expect(res.statusCode).toBe(400);
    expect(fieldCode(res.json(), "receivedDate")).toBe(code);
  });
  it("accepted more than received -> 400 ACCEPTED_EXCEEDS_RECEIVED on the line (G05)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/procurement/grns", headers, payload: grn({}, { receivedQty: 1, acceptedQty: 2 }) });
    expect(res.statusCode).toBe(400);
    expect(fieldCode(res.json(), "items.0.acceptedQty")).toBe("ACCEPTED_EXCEEDS_RECEIVED");
  });
});
