/**
 * GAP-PAYROLL-COSTING-01/02: payroll staff read the cost-centre master (to
 * pick a centre for a costing rule and to label the costing report) --
 * GET only; creating cost centres stays finance-admin.
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";

vi.mock("../src/shared/db.js", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../src/shared/db.js");
  const chain = { from: () => ({ where: () => Promise.resolve([]) }) };
  return { ...actual, scopedRead: (cb: (tx: unknown) => unknown) => cb({ select: () => chain }) };
});

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000b4";
const tok = (roles: string[]) => signToken({ sub: "u-b4", tid: TENANT, roles, sid: "s-b4" }, SECRET);

afterAll(async () => { await sqlClient.end(); });

describe("GET /v1/finance/cost-centers -- payroll read access", () => {
  it.each(["payroll_admin", "payroll_officer", "hr_admin", "hr_officer"])("admits %s", async (role) => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/finance/cost-centers", headers: { authorization: `Bearer ${tok([role])}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("still rejects employee", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/finance/cost-centers", headers: { authorization: `Bearer ${tok(["employee"])}` } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("does not let payroll roles create cost centres", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/finance/cost-centers", headers: { authorization: `Bearer ${tok(["payroll_admin"])}` }, payload: {} });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
