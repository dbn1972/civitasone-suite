/**
 * finance-service HTTP route tests (inject)
 *
 * Asserts every list/detail/dashboard route returns 200 + correct shape.
 * Uses HS256 test JWTs (JWT_ALGORITHM=HS256 set in vitest.config.ts).
 * No seeded DB rows → routes return [] / empty objects, but schema validates.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";

function makeToken(roles: string[] = ["finance_officer"]) {
  return signToken(
    { sub: "user-001", tid: TENANT, roles, sid: "sess-001" },
    SECRET,
  );
}

afterAll(async () => { await sqlClient.end(); });

describe("GET /v1/finance/dashboard — shape", () => {
  it("returns 200 with dashboard shape", async () => {
    const app = await buildApp();
    const token = makeToken(["finance_officer"]);
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/dashboard",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.pendingSanctions).toBe("number");
    expect(typeof body.paymentsThisMonth).toBe("number");
  });
});

describe("GET /v1/finance/sanctions — shape", () => {
  it("returns 200 with array shape", async () => {
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/sanctions",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("returns 403 for wrong role", async () => {
    const app = await buildApp();
    const token = makeToken(["citizen"]);
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/sanctions",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/finance/bills — shape", () => {
  it("returns 200 with array shape", async () => {
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/bills",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

describe("GET /v1/finance/advances — shape", () => {
  it("returns 200 with array shape", async () => {
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/advances",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("tenant isolation: different tenant returns 200 (empty)", async () => {
    const app = await buildApp();
    const otherTenant = "bbbbbbbb-2222-4000-8000-000000000099";
    const token = signToken({ sub: "u2", tid: otherTenant, roles: ["finance_officer"], sid: "s2" }, SECRET);
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/advances",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe("GET /v1/finance/utilization-certificates — shape", () => {
  it("returns 200 with array shape", async () => {
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/utilization-certificates",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

describe("GET /v1/finance/journals — shape", () => {
  it("returns 200 with array shape", async () => {
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/journals",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

describe("GET /v1/finance/statements — shape", () => {
  it("returns 200 with array or object shape", async () => {
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/statements",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

describe("unauthenticated requests", () => {
  it("GET /v1/finance/bills without token → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/finance/bills" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ── Test A: POST /v1/finance/journals — unbalanced journal → 400 ────────────

describe("POST /v1/finance/journals — unbalanced journal rejection", () => {
  it("rejects unbalanced journal (Dr ≠ Cr) with 400", async () => {
    const app = await buildApp();
    const token = makeToken(["finance_officer"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/finance/journals",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {
        voucherNo: "VCH-TEST-UNBALANCED",
        type: "journal",
        postingDate: "2024-07-01",
        lines: [
          { accountCode: "0001", debitMinor: 60000, creditMinor: 0 },
          { accountCode: "0002", debitMinor: 0, creditMinor: 50000 },
          // debit=60000, credit=50000 → unbalanced by 10000
        ],
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toMatch(/VALIDATION_FAILED|JOURNAL_UNBALANCED/i);
  });

  it("accepts balanced journal (Dr = Cr) with 202", async () => {
    const app = await buildApp();
    const token = makeToken(["finance_officer"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/finance/journals",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {
        voucherNo: "VCH-TEST-BALANCED",
        type: "journal",
        postingDate: "2024-07-01",
        lines: [
          { accountCode: "0001", debitMinor: 50000, creditMinor: 0 },
          { accountCode: "0002", debitMinor: 0, creditMinor: 50000 },
        ],
      },
    });
    await app.close();
    // 202 = accepted into queue; the consumer enforces further domain rules
    expect(res.statusCode).toBe(202);
  });

  it("rejects journal with fewer than 2 lines with 400", async () => {
    const app = await buildApp();
    const token = makeToken(["finance_officer"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/finance/journals",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {
        voucherNo: "VCH-TEST-SINGLE",
        type: "journal",
        postingDate: "2024-07-01",
        lines: [
          { accountCode: "0001", debitMinor: 100, creditMinor: 100 },
        ],
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

// ── Test B: POST /v1/finance/bills — invalid body → 400 ─────────────────────
//
// Note: Over-budget enforcement is a domain rule enforced by the bill consumer
// (the route itself accepts any valid bill into the CQRS queue and returns 202).
// Budget-exceeded validation is covered by the pure domain test in finance.test.ts.
// Here we verify that:
//   1. A malformed bill body (missing required fields) returns 400 (zod validation).
//   2. A valid bill body is accepted with 202 (over-budget is caught asynchronously).

describe("POST /v1/finance/bills — input validation", () => {
  it("rejects bill missing required vendorId with 400", async () => {
    const app = await buildApp();
    const token = makeToken(["finance_officer"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/finance/bills",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {
        billNo: "BILL-INVALID-001",
        // vendorId intentionally omitted
        headId: "aaaaaaaa-0000-4000-8000-000000000001",
        grossMinor: 50000,
        currency: "INR",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("rejects bill with zero grossMinor with 400", async () => {
    const app = await buildApp();
    const token = makeToken(["finance_officer"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/finance/bills",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {
        billNo: "BILL-ZERO-001",
        vendorId: "aaaaaaaa-0000-4000-8000-000000000001",
        headId: "bbbbbbbb-0000-4000-8000-000000000001",
        grossMinor: 0,   // must be positive
        currency: "INR",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("accepts a valid bill and returns 202 (CQRS async pattern)", async () => {
    const app = await buildApp();
    const token = makeToken(["finance_officer"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/finance/bills",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {
        billNo: "BILL-VALID-001",
        vendorId: "aaaaaaaa-0000-4000-8000-000000000002",
        headId: "bbbbbbbb-0000-4000-8000-000000000002",
        ddoCode: "DDO123456",
        grossMinor: 75000,
        currency: "INR",
        deductions: [],
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("accepted");
    expect(typeof body.id).toBe("string");
  });
});
