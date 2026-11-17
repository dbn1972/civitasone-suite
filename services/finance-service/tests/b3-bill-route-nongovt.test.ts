/**
 * Segment Phase B3, ROUTE level: POST /v1/finance/bills must not demand a govt HoA / DDO of a non-govt tenant, and a govt
 * tenant is refused exactly as before. Real route + real validators; repo / masters / commands / DB access are mocked, so no
 * Postgres is needed.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import { signToken } from "@civitasone/auth";

const state = vi.hoisted(() => ({ template: "govt" as string, head: null as Record<string, unknown> | null, hasChildren: false }));
const createBill = vi.fn();

vi.mock("../src/shared/db.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/shared/db.js")>()),
  scopedRead: async (fn: (tx: unknown) => unknown) => fn({}),
}));
vi.mock("../src/modules/gl/coa-template.js", () => ({ resolveCoaTemplateTx: async () => ({ template: state.template, packs: [] }) }));
vi.mock("../src/modules/payments/commands.js", () => ({ createBill: (...a: unknown[]) => createBill(...a) }));
vi.mock("../src/modules/masters/repo.js", () => ({ getVendorById: async () => null, ddoExists: async () => false }));
vi.mock("../src/modules/budget/repo.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/modules/budget/repo.js")>()),
  findHeadByIdAndTenant: vi.fn(async () => state.head),
  hasChildHeadsTx: vi.fn(async () => state.hasChildren),
}));

import { paymentsRoutes } from "../src/modules/payments/routes.js";
import { financeErrorHandler } from "../src/shared/context.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-3333-4000-8000-0000000000c1";
const ACTOR = "00000000-aaaa-4000-8000-0000000000c1";
const VENDOR = "66666666-aaaa-4000-8000-0000000000c1";
const HEAD = "66666666-bbbb-4000-8000-0000000000c1";
const hdr = { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["finance_officer"], sid: "s" }, SECRET)}` };
const body = { billNo: "INV-1", vendorId: VENDOR, headId: HEAD, grossMinor: "100000" };
async function post(payload: Record<string, unknown>) {
  const a = Fastify();
  a.setErrorHandler(financeErrorHandler);
  await a.register(paymentsRoutes);
  await a.ready();
  return a.inject({ method: "POST", url: "/v1/finance/bills", headers: hdr, payload });
}
const head = (over: Record<string, unknown> = {}) => ({ id: HEAD, tenantId: TENANT, code: "5400", classification: "expense", isControl: false, hoaCode: null, ...over });

let prev: string | undefined;
beforeAll(() => { prev = process.env.TENANT_PROFILES_ENABLED; process.env.TENANT_PROFILES_ENABLED = "true"; });
afterAll(() => { if (prev === undefined) delete process.env.TENANT_PROFILES_ENABLED; else process.env.TENANT_PROFILES_ENABLED = prev; });
beforeEach(() => { createBill.mockReset().mockResolvedValue({ id: "x", status: "accepted", correlationId: "c" }); state.hasChildren = false; });

describe("B3 route: non-govt bills need no HoA and no DDO", () => {
  it.each(["commercial", "nonprofit"])("%s: a NULL-hoaCode leaf expense head and no ddoCode is accepted (202)", async (template) => {
    state.template = template; state.head = head();
    const res = await post(body);
    expect(res.statusCode).toBe(202);
    expect(createBill).toHaveBeenCalledTimes(1);
  });
  it("a present but malformed ddoCode is still refused by the body schema", async () => {
    state.template = "commercial"; state.head = head();
    expect((await post({ ...body, ddoCode: "!!" })).statusCode).toBe(400);
  });
  it("still refuses a missing head (HEAD_NOT_FOUND), a group head and a non-expense head with 422", async () => {
    state.template = "nonprofit"; state.head = null;
    let res = await post(body);
    expect([res.statusCode, JSON.parse(res.body).code]).toEqual([422, "HEAD_NOT_FOUND"]);
    state.head = head(); state.hasChildren = true;
    res = await post(body);
    expect([res.statusCode, JSON.parse(res.body).code]).toEqual([422, "BILL_HEAD_INVALID"]);
    state.hasChildren = false; state.head = head({ code: "1100", classification: "asset" });
    res = await post(body);
    expect([res.statusCode, JSON.parse(res.body).code]).toEqual([422, "BILL_HEAD_INVALID"]);
    expect(createBill).not.toHaveBeenCalled();
  });
});

describe("B3 route: govt is unchanged", () => {
  it("a govt bill on a head with a NULL hoaCode is refused 422 HOA_EMPTY, as before", async () => {
    state.template = "govt"; state.head = head({ code: "2202", classification: "expenditure", hoaCode: null });
    const res = await post({ ...body, ddoCode: "DDO123456" });
    expect([res.statusCode, JSON.parse(res.body).code]).toEqual([422, "HOA_EMPTY"]);
    expect(createBill).not.toHaveBeenCalled();
  });
  it("a govt bill without a ddoCode is still a 400 body-validation error", async () => {
    state.template = "govt"; state.head = head({ code: "2202", classification: "expenditure", hoaCode: "220201101010101010" });
    expect((await post(body)).statusCode).toBe(400);
  });
});
