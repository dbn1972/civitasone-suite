/**
 * DOM-013 — POST /v1/finance/vendor-tds route-level enforcement.
 * Confirms the zod refine wired into routes.ts actually rejects a
 * stale-rate/section combination over HTTP (400), and still accepts a
 * currently-valid combination.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";

function token(roles: string[] = ["finance_officer"]) {
  return signToken({ sub: "user-001", tid: TENANT, roles, sid: "sess-001" }, SECRET);
}

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    vendorId: randomUUID(),
    grossAmountMinor: 100000,
    tdsAmountMinor: 2000,
    netPaymentMinor: 98000,
    deductionDate: "2026-09-11",
    quarter: "Q2",
    fy: "2026-27",
    ...overrides,
  };
}

afterAll(async () => { await sqlClient.end(); });

describe("POST /v1/finance/vendor-tds — DOM-013 rate/section enforcement", () => {
  it("rejects a lapsed COVID-era rate (7.5%) for section 194J on a current-date deduction", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/finance/vendor-tds",
      headers: { authorization: `Bearer ${token()}` },
      payload: basePayload({ section: "194J", tdsRatePct: 7.5, tdsAmountMinor: 7500 }),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a free-text / unknown section value", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/finance/vendor-tds",
      headers: { authorization: `Bearer ${token()}` },
      payload: basePayload({ section: "NOT_A_SECTION", tdsRatePct: 2 }),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("accepts a currently-valid section+rate for a current-date deduction", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/finance/vendor-tds",
      headers: { authorization: `Bearer ${token()}` },
      payload: basePayload({ section: "194C", tdsRatePct: 2, tdsAmountMinor: 2000 }),
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });
});
