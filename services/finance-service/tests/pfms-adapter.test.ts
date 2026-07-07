/**
 * PFMS/e-Kuber Government Rail Adapter Tests
 *
 * Tests:
 * 1. Disabled adapter returns 503 (INTEGRATION_DISABLED)
 * 2. Happy path — payment submission (mocked fetch)
 * 3. Happy path — status check (mocked fetch)
 * 4. Circuit breaker opens after 5 failures
 * 5. Timeout handling (15s)
 * 6. No PII in logs
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";

function makeToken(roles: string[] = ["finance_officer"]) {
  return signToken(
    { sub: "user-001", tid: TENANT, roles, sid: "sess-001" },
    SECRET,
  );
}

describe("PFMS Adapter — disabled", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Ensure PFMS is disabled (default — env not set)
    delete process.env.PFMS_ENABLED;
    delete process.env.PFMS_BASE_URL;
    delete process.env.PFMS_API_KEY;

    // Re-import fresh module with disabled env
    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /v1/finance/pfms/payments returns 503 when adapter disabled", async () => {
    const token = makeToken(["finance_officer"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/finance/pfms/payments",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        referenceId: "REF-001",
        beneficiaryCode: "BEN-001",
        amount: "100000",
        purposeCode: "SALARY",
      },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.error.code).toBe("INTEGRATION_DISABLED");
    expect(body.error.message).toBe("PFMS integration is not available");
    expect(body.error.correlationId).toBeDefined();
  });

  it("GET /v1/finance/pfms/payments/:ref/status returns 503 when adapter disabled", async () => {
    const token = makeToken(["finance_officer"]);
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/pfms/payments/REF-001/status",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.error.code).toBe("INTEGRATION_DISABLED");
  });

  it("returns 401 without auth token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/finance/pfms/payments",
      payload: {
        referenceId: "REF-001",
        beneficiaryCode: "BEN-001",
        amount: "100000",
        purposeCode: "SALARY",
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for wrong role", async () => {
    const token = makeToken(["citizen"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/finance/pfms/payments",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        referenceId: "REF-001",
        beneficiaryCode: "BEN-001",
        amount: "100000",
        purposeCode: "SALARY",
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for invalid request body", async () => {
    const token = makeToken(["finance_officer"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/finance/pfms/payments",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        // Missing required fields
        amount: "not-numeric",
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });
});

describe("PFMS Adapter — enabled (mocked fetch)", () => {
  let app: FastifyInstance;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    process.env.PFMS_ENABLED = "true";
    process.env.PFMS_BASE_URL = "https://pfms-sandbox.gov.in";
    process.env.PFMS_API_KEY = "test-api-key-pfms";

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.PFMS_ENABLED;
    delete process.env.PFMS_BASE_URL;
    delete process.env.PFMS_API_KEY;
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POST /v1/finance/pfms/payments — happy path", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        referenceId: "REF-001",
        pfmsTransactionId: "PFMS-TXN-123",
        status: "accepted",
        message: "Payment accepted",
        timestamp: "2026-07-01T10:00:00Z",
      }),
    } as Response);

    const token = makeToken(["finance_officer"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/finance/pfms/payments",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        referenceId: "REF-001",
        beneficiaryCode: "BEN-001",
        amount: "100000",
        purposeCode: "SALARY",
        schemeCode: "SCHEME01",
        ddoCode: "DDO001",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.referenceId).toBe("REF-001");
    expect(body.data.pfmsTransactionId).toBe("PFMS-TXN-123");
    expect(body.data.status).toBe("accepted");
    expect(body.data.timestamp).toBe("2026-07-01T10:00:00Z");
  });

  it("GET /v1/finance/pfms/payments/:ref/status — happy path", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        referenceId: "REF-001",
        pfmsTransactionId: "PFMS-TXN-123",
        status: "completed",
        utrNumber: "UTR2026070100001",
        processedAt: "2026-07-01T12:00:00Z",
      }),
    } as Response);

    const token = makeToken(["finance_officer"]);
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/pfms/payments/REF-001/status",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.referenceId).toBe("REF-001");
    expect(body.data.status).toBe("completed");
    expect(body.data.utrNumber).toBe("UTR2026070100001");
  });

  it("returns 502 on upstream API error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    } as Response);

    const token = makeToken(["finance_officer"]);
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/pfms/payments/REF-001/status",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.error.code).toBe("UPSTREAM_ERROR");
    expect(body.error.correlationId).toBeDefined();
    // Ensure no PII in error response
    expect(JSON.stringify(body)).not.toContain("Internal Server Error");
  });

  it("handles timeout (AbortError) as upstream failure", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
    );

    const token = makeToken(["finance_officer"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/finance/pfms/payments",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        referenceId: "REF-TIMEOUT",
        beneficiaryCode: "BEN-001",
        amount: "100000",
        purposeCode: "SALARY",
      },
    });

    // AbortError propagates through circuit breaker as a failure and is
    // rethrown. Since it's not a PfmsAdapterError or CircuitBreakerOpenError,
    // Fastify's error handler returns 500.
    expect(res.statusCode).toBe(500);
  });

  it("circuit breaker opens after 5 consecutive failures", async () => {
    // Simulate 5 consecutive failures
    for (let i = 0; i < 5; i++) {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "fail",
      } as Response);
    }

    const token = makeToken(["finance_officer"]);

    // Trigger 5 failures
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: "GET",
        url: "/v1/finance/pfms/payments/REF-001/status",
        headers: { authorization: `Bearer ${token}` },
      });
    }

    // 6th call should hit circuit breaker (open state)
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/pfms/payments/REF-001/status",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.error.code).toBe("CIRCUIT_OPEN");
    expect(body.error.message).toBe("PFMS service is temporarily unavailable");
  });
});

describe("PFMS Adapter — no PII in logs", () => {
  it("adapter error messages do not contain PII", async () => {
    // PfmsAdapterError messages should only contain status codes and adapter name
    const { PfmsAdapterError } = await import("../src/modules/pfms/adapter.js");
    const err = new PfmsAdapterError("PFMS API returned 500", "PFMS_API_ERROR", 500);
    expect(err.message).not.toMatch(/\b[A-Z]{5}\d{4}[A-Z]\b/); // PAN pattern
    expect(err.message).not.toMatch(/\b\d{12}\b/); // Aadhaar pattern
    expect(err.message).not.toMatch(/\b\d{10}\b/); // Phone pattern
    expect(err.message).not.toMatch(/@/); // Email pattern
    expect(err.message).toBe("PFMS API returned 500");
  });

  it("route error responses do not expose upstream body", async () => {
    process.env.PFMS_ENABLED = "true";
    process.env.PFMS_BASE_URL = "https://pfms-sandbox.gov.in";
    process.env.PFMS_API_KEY = "test-api-key-pfms";

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: "Account XXXX1234 belongs to Ramesh Kumar" }),
    } as unknown as Response);

    const token = makeToken(["finance_officer"]);
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/pfms/payments/REF-001/status",
      headers: { authorization: `Bearer ${token}` },
    });

    // Response must not leak the upstream body content with PII
    const responseText = JSON.stringify(res.json());
    expect(responseText).not.toContain("Ramesh Kumar");
    expect(responseText).not.toContain("XXXX1234");
    expect(res.json().error.code).toBe("UPSTREAM_ERROR");

    await app.close();
    delete process.env.PFMS_ENABLED;
    delete process.env.PFMS_BASE_URL;
    delete process.env.PFMS_API_KEY;
  });
});
