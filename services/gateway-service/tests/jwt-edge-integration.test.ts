/**
 * jwt-edge.ts — SEC-P0 integration confirmation.
 *
 * Same property as jwt-edge.test.ts's unit tests, but exercised against the REAL
 * Fastify app (buildApp + inject) and a REAL signed token, matching the pattern in
 * tests/security.test.ts. This confirms the fix holds against Fastify's actual
 * request/header handling and the actual upstream-proxy header-forwarding path,
 * not just the isolated jwtEdgeVerify function against a plain mock req object.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";

const SECRET = "test_secret_for_civitasone_32chr";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("jwtEdgeVerify — integration: forged x-tenant-id never reaches upstream", () => {
  it("a token with no tid claim does not let a forged x-tenant-id reach upstream", async () => {
    // Deliberately no tid/tenantId claim — the exact condition this fix targets.
    const tokenNoTenant = signToken({ sub: "actor-no-tenant", roles: ["admin"] }, SECRET, 3600);

    let lastUpstreamHeaders: Record<string, string> = {};
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      lastUpstreamHeaders = Object.fromEntries(
        Object.entries((init?.headers as Record<string, string>) ?? {}),
      );
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: "/api/v1/finance/bills",
      headers: {
        authorization: `Bearer ${tokenNoTenant}`,
        "x-tenant-id": "forged-victim-tenant-zzz",
      },
    });

    expect(lastUpstreamHeaders["x-tenant-id"]).toBeUndefined();
  });

  it("a token WITH a tid claim still overwrites a forged x-tenant-id (existing behavior, unbroken)", async () => {
    const tokenWithTenant = signToken(
      { sub: "actor-1", tid: "real-tenant-aaa", roles: ["admin"] },
      SECRET,
      3600,
    );

    let lastUpstreamHeaders: Record<string, string> = {};
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      lastUpstreamHeaders = Object.fromEntries(
        Object.entries((init?.headers as Record<string, string>) ?? {}),
      );
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: "/api/v1/finance/bills",
      headers: {
        authorization: `Bearer ${tokenWithTenant}`,
        "x-tenant-id": "forged-victim-tenant-zzz",
      },
    });

    expect(lastUpstreamHeaders["x-tenant-id"]).toBe("real-tenant-aaa");
  });
});
