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
 * 7. Reconciliation — adapter submissions/status land in the same
 *    payments.finance_pfms ledger routes.ts's treasury batch path uses
 *    (channel = 'ekuber_adapter'), and routes.ts refuses to sign/bank-file
 *    a row from that channel.
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
// A real UUID, not a friendly placeholder: this actorId now flows into
// financePfms.createdBy/updatedBy (uuid NOT NULL) once the adapter's own
// persistence lands (repo.upsertAdapterPfmsRecord) — a non-UUID sub, as this
// used to be, fails that insert since the adapter route now does a real DB
// write on the happy path.
const ACTOR = "cccccccc-1111-4000-8000-000000000001";

function makeToken(roles: string[] = ["finance_officer"]) {
  return signToken(
    { sub: ACTOR, tid: TENANT, roles, sid: "sess-001" },
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

  describe("reconciliation with the treasury batch ledger", () => {
    // Dedicated referenceId so these assertions don't depend on execution
    // order against the REF-001 rows the tests above create/mutate.
    const REF = "REF-RECON-001";

    it("a successful submission is traceable via GET /v1/finance/pfms/batches (channel = ekuber_adapter)", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          referenceId: REF,
          pfmsTransactionId: "PFMS-TXN-RECON-1",
          status: "accepted",
          timestamp: "2026-07-01T10:00:00Z",
        }),
      } as Response);

      const token = makeToken(["finance_officer"]);
      const submitRes = await app.inject({
        method: "POST",
        url: "/v1/finance/pfms/payments",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          referenceId: REF,
          beneficiaryCode: "BEN-RECON",
          amount: "250000",
          purposeCode: "SALARY",
          schemeCode: "SCHEME01",
          ddoCode: "DDO001",
        },
      });
      expect(submitRes.statusCode).toBe(201);

      // This is routes.ts's pre-existing status lookup — the treasury batch
      // path's only surface for "was this disbursement actually paid". Before
      // this fix, an e-Kuber submission would never appear here.
      const listRes = await app.inject({
        method: "GET",
        url: "/v1/finance/pfms/batches",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(listRes.statusCode).toBe(200);
      const row = listRes.json().data.find((b: { pfmsId: string }) => b.pfmsId === REF);
      expect(row).toBeDefined();
      expect(row.channel).toBe("ekuber_adapter");
      expect(row.submissionStatus).toBe("accepted");
      expect(row.amountMinor).toBe("250000");
      expect(row.schemeCode).toBe("SCHEME01");
      expect(row.ddoCode).toBe("DDO001");
    });

    it("a later status check updates the SAME ledger row rather than creating a second one", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          referenceId: REF,
          pfmsTransactionId: "PFMS-TXN-RECON-1",
          status: "completed",
          utrNumber: "UTR2026070100099",
          processedAt: "2026-07-02T09:00:00Z",
        }),
      } as Response);

      const token = makeToken(["finance_officer"]);
      const statusRes = await app.inject({
        method: "GET",
        url: `/v1/finance/pfms/payments/${REF}/status`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(statusRes.statusCode).toBe(200);

      const listRes = await app.inject({
        method: "GET",
        url: "/v1/finance/pfms/batches",
        headers: { authorization: `Bearer ${token}` },
      });
      const matches = listRes.json().data.filter((b: { pfmsId: string }) => b.pfmsId === REF);
      expect(matches).toHaveLength(1);
      expect(matches[0].submissionStatus).toBe("completed");
      expect(matches[0].utrNumber).toBe("UTR2026070100099");
    });

    it("routes.ts refuses to sign or bank-file an e-Kuber adapter row (INVALID_CHANNEL)", async () => {
      const token = makeToken(["finance_officer"]);
      const listRes = await app.inject({
        method: "GET",
        url: "/v1/finance/pfms/batches",
        headers: { authorization: `Bearer ${token}` },
      });
      const row = listRes.json().data.find((b: { pfmsId: string }) => b.pfmsId === REF);
      expect(row).toBeDefined();

      const signRes = await app.inject({
        method: "POST",
        url: `/v1/finance/pfms/${row.id}/sign`,
        headers: { authorization: `Bearer ${token}` },
        payload: { certificateRef: "cert-1", signaturePayload: "payload-1" },
      });
      expect(signRes.statusCode).toBe(400);
      expect(signRes.json().code).toBe("INVALID_CHANNEL");

      const bankFileRes = await app.inject({
        method: "GET",
        url: `/v1/finance/pfms/${row.id}/bank-file`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(bankFileRes.statusCode).toBe(400);
      expect(bankFileRes.json().code).toBe("INVALID_CHANNEL");
    });
  });

  describe("cross-tenant isolation (SEC — PR #1591 follow-up)", () => {
    // A second, independent tenant/actor. makeToken()'s ACTOR/TENANT
    // constants are fixed to one tenant, so cross-tenant tests mint their
    // own token directly with signToken.
    const TENANT_B = "bbbbbbbb-2222-4000-8000-000000000099";
    const ACTOR_B = "dddddddd-2222-4000-8000-000000000001";
    function makeTokenForTenant(tenantId: string, actorId: string, roles: string[] = ["finance_officer"]) {
      return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-002" }, SECRET);
    }

    const REF = "REF-XTENANT-001";

    it("Tenant A submits a payment; Tenant B checking that exact reference gets 404, never Tenant A's real e-Kuber data", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          referenceId: REF,
          pfmsTransactionId: "PFMS-TXN-XTENANT-1",
          status: "accepted",
          timestamp: "2026-09-26T10:00:00Z",
        }),
      } as Response);

      const tokenA = makeToken(["finance_officer"]);
      const submitRes = await app.inject({
        method: "POST",
        url: "/v1/finance/pfms/payments",
        headers: { authorization: `Bearer ${tokenA}` },
        payload: {
          referenceId: REF,
          beneficiaryCode: "BEN-XTENANT",
          amount: "500000",
          purposeCode: "SALARY",
        },
      });
      expect(submitRes.statusCode).toBe(201);

      // Tenant A can immediately check their own reference's status normally.
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          referenceId: REF,
          pfmsTransactionId: "PFMS-TXN-XTENANT-1",
          status: "completed",
          utrNumber: "UTR2026092600001",
          processedAt: "2026-09-26T11:00:00Z",
        }),
      } as Response);
      const ownStatusRes = await app.inject({
        method: "GET",
        url: `/v1/finance/pfms/payments/${REF}/status`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(ownStatusRes.statusCode).toBe(200);
      expect(ownStatusRes.json().data.status).toBe("completed");

      // Tenant B -- a completely different tenant -- tries the EXACT SAME
      // referenceId. Before this fix this would hit the shared e-Kuber
      // credential and return Tenant A's real payment data, then persist it
      // into Tenant B's own ledger row. No fetch mock is queued for this
      // call: if checkStatus() were reached despite the guard, the empty
      // mock queue makes fetch() return undefined and the route would blow
      // up with a 500, not silently succeed -- so this assertion is a real
      // regression check, not just an assertion on the intended path.
      const tokenB = makeTokenForTenant(TENANT_B, ACTOR_B);
      const crossRes = await app.inject({
        method: "GET",
        url: `/v1/finance/pfms/payments/${REF}/status`,
        headers: { authorization: `Bearer ${tokenB}` },
      });
      expect(crossRes.statusCode).toBe(404);
      expect(crossRes.json().error.code).toBe("NOT_FOUND");
      // Must never leak that the reference exists for someone else, or any
      // of Tenant A's real e-Kuber data.
      const crossBody = JSON.stringify(crossRes.json());
      expect(crossBody).not.toContain("UTR2026092600001");
      expect(crossBody).not.toContain("completed");

      // The local ledger must not end up with a Tenant-B-attributed row for
      // Tenant A's reference: Tenant B's own batch list has no trace of it,
      // and Tenant A's own row is unaffected by Tenant B's rejected attempt.
      const bBatches = await app.inject({
        method: "GET",
        url: "/v1/finance/pfms/batches",
        headers: { authorization: `Bearer ${tokenB}` },
      });
      expect(bBatches.statusCode).toBe(200);
      expect(bBatches.json().data.find((b: { pfmsId: string }) => b.pfmsId === REF)).toBeUndefined();

      const aBatches = await app.inject({
        method: "GET",
        url: "/v1/finance/pfms/batches",
        headers: { authorization: `Bearer ${tokenA}` },
      });
      const aRow = aBatches.json().data.find((b: { pfmsId: string }) => b.pfmsId === REF);
      expect(aRow).toBeDefined();
      expect(aRow.submissionStatus).toBe("completed");
      expect(aRow.utrNumber).toBe("UTR2026092600001");
    });

    it("Tenant B cannot submit a NEW payment using a referenceId Tenant A already claimed", async () => {
      // REF was claimed by Tenant A in the previous test. No fetch mock is
      // queued: e-Kuber must never be called for a rejected submission.
      const tokenB = makeTokenForTenant(TENANT_B, ACTOR_B);
      const res = await app.inject({
        method: "POST",
        url: "/v1/finance/pfms/payments",
        headers: { authorization: `Bearer ${tokenB}` },
        payload: {
          referenceId: REF,
          beneficiaryCode: "BEN-B-ATTEMPT",
          amount: "999999",
          purposeCode: "SALARY",
        },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("REFERENCE_ALREADY_IN_USE");
    });

    it("Tenant A rechecking their OWN referenceId is unaffected by the cross-tenant guard", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          referenceId: REF,
          pfmsTransactionId: "PFMS-TXN-XTENANT-1",
          status: "completed",
          utrNumber: "UTR2026092600002",
          processedAt: "2026-09-26T12:00:00Z",
        }),
      } as Response);
      const tokenA = makeToken(["finance_officer"]);
      const res = await app.inject({
        method: "GET",
        url: `/v1/finance/pfms/payments/${REF}/status`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.utrNumber).toBe("UTR2026092600002");
    });

    it("a referenceId neither tenant has ever touched 404s for both (no existence oracle)", async () => {
      const UNKNOWN_REF = "REF-NEVER-SUBMITTED-XYZ";
      const tokenA = makeToken(["finance_officer"]);
      const tokenB = makeTokenForTenant(TENANT_B, ACTOR_B);

      const resA = await app.inject({
        method: "GET",
        url: `/v1/finance/pfms/payments/${UNKNOWN_REF}/status`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(resA.statusCode).toBe(404);
      expect(resA.json().error.code).toBe("NOT_FOUND");

      const resB = await app.inject({
        method: "GET",
        url: `/v1/finance/pfms/payments/${UNKNOWN_REF}/status`,
        headers: { authorization: `Bearer ${tokenB}` },
      });
      expect(resB.statusCode).toBe(404);
      expect(resB.json().error.code).toBe("NOT_FOUND");
    });
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
