/**
 * GAP2-SHELL-PROXY-01 — the proxy must strip a client-controlled x-tenant-id /
 * x-actor-id and re-inject only a server-verified value, UNCONDITIONALLY, in
 * every GATEWAY_JWT_EDGE_VERIFY mode (true / audit / off) — not just inside
 * jwtEdgeVerify's happy path.
 *
 * On main today the authoritative overwrite lives only in jwtEdgeVerify, which
 * returns early in "off" mode (and on a failed verify under "audit" mode) before
 * touching those headers. proxyHandler then copied x-tenant-id/x-actor-id verbatim
 * via FORWARD_HEADERS, so an authenticated user could forge a victim tenant id in
 * the header and have it trusted downstream (createTenantTxHook sources the RLS GUC
 * straight from x-tenant-id) — a cross-tenant RLS bypass. This test fails on the old
 * code for the "off" (and "audit"-with-untrusted-token) modes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { applyConfig } from "../src/runtime-config.js";
import { _test as moduleGuardTest } from "../src/module-guard.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr"; // gitleaks:allow
const TENANT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TENANT_B = "bbbbbbbb-0000-4000-8000-000000000002";
const ACTOR_A = "11111111-0000-4000-8000-000000000001";

function tokenForA(): string {
  return signToken({ sub: ACTOR_A, tid: TENANT_A, roles: ["finance_officer"] }, SECRET, 3600);
}

let forwarded: Record<string, string | undefined> = {};

beforeEach(() => {
  moduleGuardTest.moduleCache.clear();
  forwarded = {};
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    const h = (init?.headers as Record<string, string>) ?? {};
    forwarded = h;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  applyConfig({ jwtEdgeVerify: "true" });
  moduleGuardTest.moduleCache.clear();
});

async function proxyWithForgedTenant(): Promise<void> {
  const app = await buildApp();
  await app.inject({
    method: "GET",
    url: "/api/v1/queue/status",
    headers: {
      authorization: `Bearer ${tokenForA()}`,
      "x-tenant-id": TENANT_B, // forged victim tenant
      "x-actor-id": "forged-actor", // forged actor
    },
  });
}

describe("GAP2-SHELL-PROXY-01 — tenant/actor header strip across all edge-verify modes", () => {
  it("mode=true: forged x-tenant-id/x-actor-id are replaced by the verified claims", async () => {
    applyConfig({ jwtEdgeVerify: "true" });
    await proxyWithForgedTenant();
    expect(forwarded["x-tenant-id"]).toBe(TENANT_A);
    expect(forwarded["x-tenant-id"]).not.toBe(TENANT_B);
    expect(forwarded["x-actor-id"]).toBe(ACTOR_A);
    expect(forwarded["x-actor-id"]).not.toBe("forged-actor");
  });

  it("mode=audit: forged x-tenant-id/x-actor-id are replaced by the verified claims", async () => {
    applyConfig({ jwtEdgeVerify: "audit" });
    await proxyWithForgedTenant();
    expect(forwarded["x-tenant-id"]).toBe(TENANT_A);
    expect(forwarded["x-tenant-id"]).not.toBe(TENANT_B);
    expect(forwarded["x-actor-id"]).toBe(ACTOR_A);
    expect(forwarded["x-actor-id"]).not.toBe("forged-actor");
  });

  it("mode=off: forged x-tenant-id/x-actor-id never reach upstream (fail closed — deleted)", async () => {
    // In "off" mode jwtEdgeVerify never populates req.jwtPayload, so there is no
    // verified tenant: the forged header must be DELETED (fail closed), never trusted.
    applyConfig({ jwtEdgeVerify: "off" });
    await proxyWithForgedTenant();
    expect(forwarded["x-tenant-id"]).not.toBe(TENANT_B);
    expect(forwarded["x-tenant-id"]).toBeUndefined();
    expect(forwarded["x-actor-id"]).not.toBe("forged-actor");
    expect(forwarded["x-actor-id"]).toBeUndefined();
  });
});
