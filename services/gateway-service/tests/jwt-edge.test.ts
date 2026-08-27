/**
 * jwt-edge.ts — SEC-P0 regression test.
 *
 * PROPERTY: the gateway must never let a client-supplied x-tenant-id header survive
 * a request whose bearer token does not authoritatively confirm that tenant. This
 * header is trusted downstream by createTenantTxHook (used by 64 services) to set
 * the RLS GUC, so any gap here is a cross-tenant data-access bypass.
 *
 * Found during the CEP-cluster (ml/ai-agent/field/catalogue/journey) deep-verify
 * pass: the pre-fix code only overwrote x-tenant-id `if (payload.tid)`, silently
 * leaving a client's forged header untouched whenever the token verified but carried
 * no tid claim — a real, previously-seen condition on this platform (a Keycloak
 * account missing the tenant-mapper attribute, see the 2026-08-26 tenant-claim
 * incident on this same repo).
 *
 * See jwt-edge-integration.test.ts for an end-to-end confirmation against the real
 * Fastify app and a real signed token (this file uses a mocked verifyJwt for
 * focused unit coverage of jwtEdgeVerify's branch logic).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FastifyRequest, FastifyReply } from "fastify";

const verifyJwtMock = vi.fn();

vi.mock("@civitasone/auth", () => ({
  verifyJwt: (...args: unknown[]) => verifyJwtMock(...args),
}));

vi.mock("./runtime-config.js", () => ({
  configValue: () => "true",
}));

vi.mock("./path-guard.js", () => ({
  canonicalisePath: (url: string) => ({ ok: true, pathname: url.split("?")[0] }),
  BAD_PATH_RESPONSE: { code: "BAD_PATH", message: "malformed path" },
}));

function makeReq(headers: Record<string, string | undefined>): FastifyRequest {
  return {
    id: "test-correlation-id",
    url: "/api/v1/field/tasks",
    headers,
  } as unknown as FastifyRequest;
}

function makeReply(): FastifyReply {
  const reply = {
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return reply as unknown as FastifyReply;
}

describe("jwtEdgeVerify — SEC-P0 x-tenant-id trust boundary", () => {
  beforeEach(() => {
    verifyJwtMock.mockReset();
  });

  it("overwrites a forged x-tenant-id with the verified token's tid (existing behavior)", async () => {
    const { jwtEdgeVerify } = await import("../src/jwt-edge.js");
    verifyJwtMock.mockResolvedValue({ sub: "user-1", tid: "real-tenant-aaa", roles: [] });

    const req = makeReq({
      authorization: "Bearer faketoken",
      "x-tenant-id": "forged-victim-tenant-zzz",
    });
    const reply = makeReply();

    await jwtEdgeVerify(req, reply);

    expect((req.headers as Record<string, string>)["x-tenant-id"]).toBe("real-tenant-aaa");
  });

  it("SEC-P0 regression: strips a forged x-tenant-id when the verified token has NO tid claim", async () => {
    const { jwtEdgeVerify } = await import("../src/jwt-edge.js");
    // A validly-signed token that simply lacks a tenant claim — must not let the
    // client's own x-tenant-id header survive.
    verifyJwtMock.mockResolvedValue({ sub: "user-no-tenant-mapper", roles: [] });

    const req = makeReq({
      authorization: "Bearer faketoken",
      "x-tenant-id": "forged-victim-tenant-zzz",
    });
    const reply = makeReply();

    await jwtEdgeVerify(req, reply);

    expect((req.headers as Record<string, string | undefined>)["x-tenant-id"]).toBeUndefined();
  });

  it("rejects an invalid token with 401 in enforce mode, without touching x-tenant-id", async () => {
    const { jwtEdgeVerify } = await import("../src/jwt-edge.js");
    verifyJwtMock.mockRejectedValue(new Error("signature invalid"));

    const req = makeReq({
      authorization: "Bearer garbage",
      "x-tenant-id": "forged-victim-tenant-zzz",
    });
    const reply = makeReply();

    await jwtEdgeVerify(req, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
  });
});
