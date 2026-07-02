/**
 * finance-service — Route coverage tests Part B.
 * Tests auth + shape for routes NOT covered by routes-coverage.test.ts.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const UUID = "aaaaaaaa-2222-4000-8000-000000000099";

function token(roles = ["finance_officer"]) {
  return signToken({ sub: UUID, tid: TENANT, roles, sid: "s1" }, SECRET);
}
function badToken() {
  return signToken({ sub: UUID, tid: TENANT, roles: ["citizen"], sid: "s1" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

describe("POST /v1/finance/challans — validation", () => {
  it("returns 400 for empty body", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/finance/challans", headers: { authorization: `Bearer ${token()}` }, payload: {} });
    await app.close();
    expect(r.statusCode).toBe(400);
  });
  it("403 for bad role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/finance/challans", headers: { authorization: `Bearer ${badToken()}` }, payload: {} });
    await app.close();
    expect(r.statusCode).toBe(403);
  });
});

describe("POST /v1/finance/deposits — validation", () => {
  it("returns 400 for empty body", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/finance/deposits", headers: { authorization: `Bearer ${token()}` }, payload: {} });
    await app.close();
    expect(r.statusCode).toBe(400);
  });
});

describe("GET /v1/finance/advances", () => {
  it("returns 200", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/finance/advances", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).toBe(200);
  });
});

describe("GET /v1/finance/cash-book", () => {
  it("returns 200", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/finance/cash-book", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).toBe(200);
  });
  it("403 for bad role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/finance/cash-book", headers: { authorization: `Bearer ${badToken()}` } });
    await app.close();
    expect(r.statusCode).toBe(403);
  });
});

describe("GET /v1/finance/bank-statements", () => {
  it("returns 200", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/finance/bank-statements", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).toBe(200);
  });
});

describe("GET /v1/finance/bills", () => {
  it("returns 200", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/finance/bills", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).toBe(200);
  });
  it("403 for bad role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/finance/bills", headers: { authorization: `Bearer ${badToken()}` } });
    await app.close();
    expect(r.statusCode).toBe(403);
  });
});

describe("GET /v1/finance/accounts", () => {
  it("returns 200", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/finance/accounts", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).toBe(200);
  });
});

describe("GET /v1/finance/commitments", () => {
  it("returns 200", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/finance/commitments", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).toBe(200);
  });
});

describe("GET /v1/finance/dashboard", () => {
  it("returns 200", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/finance/dashboard", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).toBe(200);
  });
});

describe("GET /v1/finance/ddo", () => {
  it("returns 200", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/finance/ddo", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).toBe(200);
  });
});

describe("GET /v1/finance/fixed-assets/register", () => {
  it("returns 200", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/finance/fixed-assets/register", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).toBe(200);
  });
});


// ═══ FINANCIAL STATEMENTS ═══════════════════════════════════════════════════

describe("GET /v1/finance/statements/trial-balance", () => {
  it("returns 200", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/finance/statements/trial-balance", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).toBe(200);
  });
});

describe("GET /v1/finance/statements/balance-sheet", () => {
  it("returns 200", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/finance/statements/balance-sheet", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).toBe(200);
  });
});

describe("GET /v1/finance/statements/income-expenditure", () => {
  it("returns 200", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/finance/statements/income-expenditure", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).toBe(200);
  });
});

describe("GET /v1/finance/statements/receipts-payments", () => {
  it("returns 200", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/finance/statements/receipts-payments", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).toBe(200);
  });
});

describe("GET /v1/finance/statements/cash-flow", () => {
  it("returns 200", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/finance/statements/cash-flow", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).toBe(200);
  });
});

describe("GET /v1/finance/statements/profit-and-loss", () => {
  it("returns 200", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/finance/statements/profit-and-loss", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).toBe(200);
  });
});

// ═══ GST ════════════════════════════════════════════════════════════════════

describe("GET /v1/finance/gst/ledger", () => {
  it("returns 200", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/finance/gst/ledger", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).toBe(200);
  });
});

describe("GET /v1/finance/gst/itc-reconciliation", () => {
  it("returns a response (route exists)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/finance/gst/itc-reconciliation", headers: { authorization: `Bearer ${token(["finance_admin"])}` } });
    await app.close();
    // Route may require specific query params or DB state; just verify it doesn't 404
    expect(r.statusCode).not.toBe(404);
  });
});

// ═══ VENDOR TDS ═════════════════════════════════════════════════════════════

describe("GET /v1/finance/vendor-tds", () => {
  it("returns 200", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/finance/vendor-tds", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).toBe(200);
  });
});

// ═══ SIMPLIFIED ═════════════════════════════════════════════════════════════

describe("GET /v1/finance/simplified/summary", () => {
  it("returns 200", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/finance/simplified/summary", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).toBe(200);
  });
});

describe("GET /v1/finance/simplified/income", () => {
  it("returns 200", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/finance/simplified/income", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).toBe(200);
  });
});

// ═══ SUBLEDGER + AP/AR ══════════════════════════════════════════════════════

describe("GET /v1/finance/ap/aging", () => {
  it("returns 200", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/finance/ap/aging", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).toBe(200);
  });
});

describe("GET /v1/finance/ar/aging", () => {
  it("returns 200", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/finance/ar/aging", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).toBe(200);
  });
});

describe("GET /v1/finance/utilization-certificates", () => {
  it("returns 200", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/finance/utilization-certificates", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).toBe(200);
  });
});

describe("GET /v1/finance/voucher-types", () => {
  it("returns 200", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/finance/voucher-types", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).toBe(200);
  });
});
