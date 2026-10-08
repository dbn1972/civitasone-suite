/**
 * GAP2-BILLING-GSTN-10 + GAP2-BILLING-GSTN-11 — GST return filing audit trail
 * and input bounds.
 *
 * GSTN-10: filing a statutory GST return (POST /v1/billing/gstn/returns) emitted
 * NO audit event. CLAUDE.md §3.8 requires every mutation to emit one. The fix
 * publishes an audit.event.record command around the adapter call on both the
 * success and failure branches. These tests spy the queue and assert a
 * `gstn_return_filed` audit carrying actor/gstin/period/amounts/outcome is
 * emitted on a 201, and a failure-outcome audit on an adapter error.
 *
 * GSTN-11: the amount fields were validated only as /^\d+$/ and returnPeriod as
 * \d{2}/\d{4} with no month/year range or magnitude bound. The fix adds refines.
 * These tests assert returnPeriod "13/2026" and an absurd tax total are rejected
 * with 400 BEFORE any adapter call.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr"; // gitleaks:allow
const TENANT = "11111111-aaaa-4000-8000-000000000001";
const ACTOR = "00000000-aaaa-4000-8000-000000000001";

function makeToken(roles: string[] = ["finance_officer"]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-gstn-audit" }, JWT_SECRET, 3600);
}

// Capture every queue.publish so we can assert on the audit command, and count
// adapter (fetch) calls so we can prove validation rejects BEFORE dispatch.
const published: Array<{ type: string; payload: Record<string, unknown> }> = [];

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    getOrLoad: vi.fn().mockResolvedValue(null),
    invalidate: vi.fn().mockResolvedValue(undefined),
    invalidateResource: vi.fn().mockResolvedValue(undefined),
  },
  queue: {
    publish: vi.fn(async (type: string, msg: { payload: Record<string, unknown> }) => {
      published.push({ type, payload: msg.payload });
    }),
    subscribe: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
  },
}));

const VALID_RETURN = {
  gstin: "22AAAAA0000A1Z5",
  returnPeriod: "07/2026",
  returnType: "GSTR3B",
  totalTaxableValue: "1000000",
  totalCgst: "90000",
  totalSgst: "90000",
  totalIgst: "0",
};

describe("GAP2-BILLING-GSTN-10/11: GST return audit trail + input bounds", () => {
  let app: FastifyInstance;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    published.length = 0;
    vi.stubEnv("JWT_SECRET", JWT_SECRET);
    vi.stubEnv("GSTN_ENABLED", "true");
    vi.stubEnv("GSTN_BASE_URL", "https://gstn-sandbox.gst.gov.in");
    vi.stubEnv("GSTN_API_KEY", "sandbox-key-gstn"); // gitleaks:allow
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        referenceId: "GSTN-RET-2026-07-001234",
        status: "submitted",
        gstin: VALID_RETURN.gstin,
        returnPeriod: VALID_RETURN.returnPeriod,
        submittedAt: "2026-08-10T09:00:00.000Z",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("GSTN-10: emits a gstn_return_filed success audit with actor/gstin/period/amounts/outcome", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/gstn/returns",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: VALID_RETURN,
    });

    expect(res.statusCode).toBe(201);
    const audit = published.find(
      (p) => p.type === "audit.event.record" && p.payload.action === "gstn_return_filed",
    );
    expect(audit).toBeDefined();
    expect(audit!.payload.outcome).toBe("success");
    expect(audit!.payload.gstin).toBe(VALID_RETURN.gstin);
    expect(audit!.payload.returnPeriod).toBe(VALID_RETURN.returnPeriod);
    expect(audit!.payload.returnType).toBe(VALID_RETURN.returnType);
    expect(audit!.payload.totalCgst).toBe(VALID_RETURN.totalCgst);
    expect(audit!.payload.totalSgst).toBe(VALID_RETURN.totalSgst);
    expect(audit!.payload.totalIgst).toBe(VALID_RETURN.totalIgst);
    expect(audit!.payload.totalTaxableValue).toBe(VALID_RETURN.totalTaxableValue);
  });

  it("GSTN-10: emits a failure-outcome audit on adapter error", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve("GSTN down") });

    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/gstn/returns",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: VALID_RETURN,
    });

    expect(res.statusCode).toBe(502);
    const audit = published.find(
      (p) => p.type === "audit.event.record" && p.payload.action === "gstn_return_filed",
    );
    expect(audit).toBeDefined();
    expect(audit!.payload.outcome).toBe("external_failure");
    expect(audit!.payload.gstin).toBe(VALID_RETURN.gstin);
  });

  it("GSTN-11: rejects returnPeriod 13/2026 (invalid month) with 400 before any adapter call", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/gstn/returns",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { ...VALID_RETURN, returnPeriod: "13/2026" },
    });

    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    // No filing audit either — rejected at validation.
    expect(published.find((p) => p.payload.action === "gstn_return_filed")).toBeUndefined();
  });

  it("GSTN-11: rejects an absurd tax total (above the paise ceiling) with 400 before any adapter call", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/gstn/returns",
      headers: { authorization: `Bearer ${makeToken()}` },
      // 10^18 paise, far above the 10^15 ceiling.
      payload: { ...VALID_RETURN, totalCgst: "1000000000000000000", totalSgst: "1000000000000000000" },
    });

    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
