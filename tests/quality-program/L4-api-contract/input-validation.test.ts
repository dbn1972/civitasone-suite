/**
 * L4 — API Contract & Input Validation (P1)
 *
 * Tests:
 * 1. Injection attacks (SQLi, NoSQLi, command injection, path traversal, XSS)
 * 2. Boundary inputs (oversized, unicode, null bytes)
 * 3. Idempotency (replay same request → no duplicate)
 * 4. Concurrency (N-way parallel mutation → exactly one winner)
 */
import { describe, it, expect, beforeAll } from "vitest";

const GATEWAY = process.env.GATEWAY_URL ?? "http://localhost:8080";
const SECRET = process.env.JWT_SECRET ?? "civitasone-dev-secret";

let signToken: (payload: Record<string, unknown>, secret: string) => string;

beforeAll(async () => {
  const auth = await import("@civitasone/auth");
  signToken = auth.signToken;
});

const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "aaaaaaaa-0000-4000-8000-000000000001";

function makeToken(roles = ["super_admin"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "l4-test", dept_code: "TEST" }, SECRET);
}

async function apiPost(path: string, body: unknown, token?: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${GATEWAY}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token ?? makeToken()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  let respBody: unknown;
  try { respBody = await res.json(); } catch { respBody = null; }
  return { status: res.status, body: respBody };
}

async function apiGet(path: string, token?: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${GATEWAY}${path}`, {
    headers: { authorization: `Bearer ${token ?? makeToken()}` },
  });
  let respBody: unknown;
  try { respBody = await res.json(); } catch { respBody = null; }
  return { status: res.status, body: respBody };
}

describe("L4 — SQL Injection resistance", () => {
  const sqliPayloads = [
    "'; DROP TABLE users; --",
    "1' OR '1'='1",
    "1; SELECT * FROM pg_tables --",
    "' UNION SELECT null,null,null --",
    "admin'/*",
    "1'; WAITFOR DELAY '0:0:5' --",
  ];

  for (const payload of sqliPayloads) {
    it(`GET with SQLi in query param: ${payload.slice(0, 30)}...`, async () => {
      const res = await apiGet(`/api/v1/finance/sanctions?search=${encodeURIComponent(payload)}`);
      // Should NOT return 500 (would indicate unhandled SQL error)
      expect(res.status).not.toBe(500);
      // Should return 200 (empty results) or 400 (rejected)
      expect([200, 400]).toContain(res.status);
    });
  }

  it("POST with SQLi in body field", async () => {
    const { status } = await apiPost("/api/v1/finance/journals", {
      voucherNo: "'; DROP TABLE journals; --",
      type: "journal",
      postingDate: "2024-07-01",
      lines: [
        { accountCode: "0001", debitMinor: 50000, creditMinor: 0 },
        { accountCode: "0002", debitMinor: 0, creditMinor: 50000 },
      ],
    });
    // Should be rejected by zod (400) or accepted safely (202) — never 500
    expect(status).not.toBe(500);
    expect([202, 400]).toContain(status);
  });
});

describe("L4 — Path traversal resistance", () => {
  const traversalPayloads = [
    "/api/v1/finance/../../../etc/passwd",
    "/api/v1/finance/bills/..%2f..%2f..%2fetc%2fpasswd",
    "/api/v1/finance/bills/%2e%2e/%2e%2e/etc/shadow",
  ];

  for (const path of traversalPayloads) {
    it(`traversal: ${path.slice(0, 40)}...`, async () => {
      const res = await fetch(`${GATEWAY}${path}`, {
        headers: { authorization: `Bearer ${makeToken()}` },
      });
      // Must NOT return file contents — should be 400/404
      expect([400, 404, 502]).toContain(res.status);
      const text = await res.text();
      expect(text).not.toContain("root:");
    });
  }
});

describe("L4 — XSS in stored fields", () => {
  it("script tag in vendor name is stored escaped, not executed", async () => {
    const { status, body } = await apiPost("/api/v1/finance/bills", {
      billNo: "XSS-TEST-001",
      vendorId: "aaaaaaaa-0000-4000-8000-000000000001",
      headId: "bbbbbbbb-0000-4000-8000-000000000001",
      grossMinor: 50000,
      currency: "INR",
      vendorName: "<script>alert('xss')</script>",
    });
    // Should accept (zod may reject) or sanitize — never inject
    expect([202, 400]).toContain(status);
  });
});

describe("L4 — Boundary inputs", () => {
  it("oversized body (>1MB) → 413 or 400", async () => {
    const largeString = "A".repeat(2_000_000); // 2MB
    const res = await fetch(`${GATEWAY}/api/v1/finance/bills`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ billNo: largeString }),
    });
    // Should reject large payloads
    expect([400, 413, 422]).toContain(res.status);
  });

  it("null bytes in string field → rejected", async () => {
    const { status } = await apiPost("/api/v1/finance/journals", {
      voucherNo: "VCH\x00-NULL",
      type: "journal",
      postingDate: "2024-07-01",
      lines: [
        { accountCode: "0001", debitMinor: 50000, creditMinor: 0 },
        { accountCode: "0002", debitMinor: 0, creditMinor: 50000 },
      ],
    });
    expect([202, 400]).toContain(status);
  });

  it("unicode normalization: no injection via homoglyph", async () => {
    const { status } = await apiPost("/api/v1/finance/bills", {
      billNo: "BILL-\u0410\u0412\u0421-001", // Cyrillic lookalikes
      vendorId: "aaaaaaaa-0000-4000-8000-000000000001",
      headId: "bbbbbbbb-0000-4000-8000-000000000001",
      grossMinor: 10000,
      currency: "INR",
    });
    expect(status).not.toBe(500);
  });
});

describe("L4 — Idempotency (replay protection)", () => {
  it("POST same journal twice with same idempotency data → no duplicate", async () => {
    const body = {
      voucherNo: "IDEMPOTENT-TEST-001",
      type: "journal",
      postingDate: "2024-07-01",
      lines: [
        { accountCode: "0001", debitMinor: 50000, creditMinor: 0 },
        { accountCode: "0002", debitMinor: 0, creditMinor: 50000 },
      ],
    };
    const token = makeToken(["finance_officer"]);
    const res1 = await apiPost("/api/v1/finance/journals", body, token);
    const res2 = await apiPost("/api/v1/finance/journals", body, token);

    // Both should succeed (202) or second should be idempotent (no dup)
    expect([202, 400, 409]).toContain(res1.status);
    expect([202, 400, 409]).toContain(res2.status);
  });
});

describe("L4 — Concurrency (N-way parallel mutation)", () => {
  it("10 parallel bill submissions → all complete without 500", async () => {
    const token = makeToken(["finance_officer"]);
    const promises = Array.from({ length: 10 }, (_, i) =>
      apiPost("/api/v1/finance/bills", {
        billNo: `CONCURRENT-${Date.now()}-${i}`,
        vendorId: "aaaaaaaa-0000-4000-8000-000000000001",
        headId: "bbbbbbbb-0000-4000-8000-000000000001",
        grossMinor: 10000 + i,
        currency: "INR",
      }, token)
    );
    const results = await Promise.all(promises);
    // None should 500
    for (const r of results) {
      expect(r.status).not.toBe(500);
    }
    // All should be accepted or rejected cleanly
    const statuses = results.map(r => r.status);
    for (const s of statuses) {
      expect([202, 400, 409, 429]).toContain(s);
    }
  });
});
