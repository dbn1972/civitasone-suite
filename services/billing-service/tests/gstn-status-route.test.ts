import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

/**
 * GAP-BILLING-GSTN-08: GET /v1/billing/gstn/status reports the adapter's
 * enabled flag + breaker state so the web console can show an honest banner
 * and disable the forms up-front, instead of the user learning only from a
 * failed filing.
 *
 * Also pins GAP-BILLING-GSTN-01 / GAP-BILLING-HOME-01: the status route (like
 * the rest of the console) is role-gated server-side — a plain tenant user
 * (role "employee") gets 403, which is why the web gate added in
 * billing/gstn/layout.tsx is defence-in-depth, not the sole control.
 */
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "11111111-aaaa-4000-8000-000000000001";
const ACTOR = "00000000-aaaa-4000-8000-000000000001";

function token(roles: string[]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-gstn-status" }, SECRET, 3600);
}

describe("GSTN status route (GAP-BILLING-GSTN-08) — disabled env", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", SECRET);
    vi.stubEnv("GSTN_ENABLED", "");
    vi.stubEnv("GSTN_BASE_URL", "");
    vi.stubEnv("GSTN_API_KEY", "");
    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("reports enabled=false when GSTN_ENABLED is not set", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/billing/gstn/status",
      headers: { authorization: `Bearer ${token(["finance_officer"])}`, "x-tenant-id": TENANT },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.enabled).toBe(false);
    expect(["closed", "open", "half-open"]).toContain(body.data.breaker);
  });

  it("requires auth (401 without a token)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/billing/gstn/status",
      headers: { "x-tenant-id": TENANT },
    });
    expect(res.statusCode).toBe(401);
  });

  it("is role-gated server-side: a plain tenant user (employee) gets 403 (GSTN-01/HOME-01)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/billing/gstn/status",
      headers: { authorization: `Bearer ${token(["employee"])}`, "x-tenant-id": TENANT },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GSTN status route — enabled env", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", SECRET);
    vi.stubEnv("GSTN_ENABLED", "true");
    vi.stubEnv("GSTN_BASE_URL", "https://gstn.example.test");
    vi.stubEnv("GSTN_API_KEY", "test-key");
    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("reports enabled=true when GSTN_ENABLED=true and base URL + key are set", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/billing/gstn/status",
      headers: { authorization: `Bearer ${token(["billing_admin"])}`, "x-tenant-id": TENANT },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.enabled).toBe(true);
  });
});
