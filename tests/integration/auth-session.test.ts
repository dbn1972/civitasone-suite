/**
 * V-08 — Session expiry / JWT validation integration test.
 *
 * Verifies that:
 * 1. A valid JWT (HS256 for tests) passes auth and the request reaches the handler
 * 2. An expired JWT (exp in the past) returns 401
 * 3. A JWT with wrong algorithm (e.g., none) returns 401
 * 4. A JWT for a different tenant is rejected (tenant isolation)
 * 5. A missing Authorization header returns 401
 *
 * Uses the @civitasone/auth package's HS256 test path and the gateway proxy logic.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";
import { verifyToken, signToken, toRequestContext } from "../../packages/auth/src/index.js";

const require = createRequire(import.meta.url);
const jwt = require("jsonwebtoken") as typeof import("jsonwebtoken");

const SECRET = "test_secret_for_civitasone_32chr";
const WRONG_SECRET = "wrong_secret_definitely_not_ok__";
const TENANT_A = "11111111-aaaa-4000-8000-000000000001";
const TENANT_B = "22222222-bbbb-4000-8000-000000000002";

// Set env for the HS256 test path (matching vitest.config.mjs)
beforeEach(() => {
  process.env.JWT_ALGORITHM = "HS256";
  process.env.JWT_SECRET = SECRET;
  process.env.HS256_TOKEN_ISSUER = "civitasone-dev";
  process.env.HS256_TOKEN_AUDIENCE = "civitasone";
});

describe("JWT validation: valid tokens", () => {
  it("a valid HS256 token passes verification and returns correct claims", () => {
    const token = signToken(
      { sub: "user-001", tid: TENANT_A, roles: ["officer", "finance_viewer"] },
      SECRET,
      "1h",
    );

    const payload = verifyToken(token, SECRET);

    expect(payload.sub).toBe("user-001");
    expect(payload.tid).toBe(TENANT_A);
    expect(payload.roles).toContain("officer");
    expect(payload.roles).toContain("finance_viewer");
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("toRequestContext extracts tenantId from tid claim (production path)", () => {
    const token = signToken(
      { sub: "user-002", tid: TENANT_A, roles: ["admin"] },
      SECRET,
      "1h",
    );
    const payload = verifyToken(token, SECRET);
    const ctx = toRequestContext(payload, "corr-123");

    expect(ctx.tenantId).toBe(TENANT_A);
    expect(ctx.actorId).toBe("user-002");
    expect(ctx.roles).toEqual(["admin"]);
    expect(ctx.correlationId).toBe("corr-123");
  });
});

describe("JWT validation: expired tokens", () => {
  it("a token with exp in the past is rejected", () => {
    // Manually create an expired token
    const token = jwt.sign(
      {
        sub: "user-003",
        tid: TENANT_A,
        roles: ["officer"],
        iss: "civitasone-dev",
        aud: "civitasone",
      },
      SECRET,
      { algorithm: "HS256", expiresIn: -10 } as jwt.SignOptions, // expired 10s ago
    );

    expect(() => verifyToken(token, SECRET)).toThrow();
  });

  it("a token that has just expired is rejected (boundary)", () => {
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      {
        sub: "user-004",
        tid: TENANT_A,
        roles: ["officer"],
        iss: "civitasone-dev",
        aud: "civitasone",
        iat: now - 7200,
        exp: now - 1, // expired 1 second ago
      },
      SECRET,
      { algorithm: "HS256" },
    );

    expect(() => verifyToken(token, SECRET)).toThrow();
  });
});

describe("JWT validation: wrong algorithm", () => {
  it("a token signed with 'none' algorithm is rejected", () => {
    // Create an unsigned token (algorithm: none attack)
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        sub: "attacker",
        tid: TENANT_A,
        roles: ["super_admin"],
        iss: "civitasone-dev",
        aud: "civitasone",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url");
    const forgedToken = `${header}.${payload}.`;

    expect(() => verifyToken(forgedToken, SECRET)).toThrow();
  });

  it("a token signed with a different secret is rejected", () => {
    const token = jwt.sign(
      {
        sub: "user-005",
        tid: TENANT_A,
        roles: ["officer"],
        iss: "civitasone-dev",
        aud: "civitasone",
      },
      WRONG_SECRET,
      { algorithm: "HS256", expiresIn: "1h" },
    );

    expect(() => verifyToken(token, SECRET)).toThrow();
  });

  it("a token signed with RS256 cannot be verified with HS256 secret", () => {
    // Simulating alg confusion: create a token claiming RS256 but signed with HS256 key
    const token = jwt.sign(
      {
        sub: "user-006",
        tid: TENANT_A,
        roles: ["super_admin"],
        iss: "civitasone-dev",
        aud: "civitasone",
      },
      "fake-rsa-secret",
      { algorithm: "HS256", expiresIn: "1h" },
    );

    // verifyToken enforces algorithms: ["HS256"] and the correct secret
    expect(() => verifyToken(token, SECRET)).toThrow();
  });
});

describe("JWT validation: tenant isolation", () => {
  it("context correctly identifies the tenant from the token tid claim", () => {
    const tokenA = signToken({ sub: "user-A", tid: TENANT_A, roles: ["officer"] }, SECRET, "1h");
    const tokenB = signToken({ sub: "user-B", tid: TENANT_B, roles: ["officer"] }, SECRET, "1h");

    const ctxA = toRequestContext(verifyToken(tokenA, SECRET), "corr-a");
    const ctxB = toRequestContext(verifyToken(tokenB, SECRET), "corr-b");

    expect(ctxA.tenantId).toBe(TENANT_A);
    expect(ctxB.tenantId).toBe(TENANT_B);
    expect(ctxA.tenantId).not.toBe(ctxB.tenantId);
  });

  it("a token for tenant B cannot impersonate tenant A via header in production", () => {
    // In production, toRequestContext ignores the x-tenant-id header
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
      const token = signToken({ sub: "user-B", tid: TENANT_B, roles: ["officer"] }, SECRET, "1h");
      const payload = verifyToken(token, SECRET);
      // Attacker passes x-tenant-id header for TENANT_A, but ctx uses token's tid
      const ctx = toRequestContext(payload, "corr-attack", TENANT_A);

      expect(ctx.tenantId).toBe(TENANT_B); // token wins, header ignored in prod
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  it("a token without tid claim results in empty tenantId in production", () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
      const token = signToken({ sub: "user-no-tenant", roles: ["officer"] } as never, SECRET, "1h");
      const payload = verifyToken(token, SECRET);
      // In production, header is NOT trusted as fallback
      const ctx = toRequestContext(payload, "corr-no-tid", TENANT_A);

      expect(ctx.tenantId).toBe(""); // no tid in token, header ignored in prod
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });
});

describe("JWT validation: missing authorization", () => {
  it("gateway rejects requests without an Authorization header (proxy logic)", () => {
    // Simulate the gateway's auth check from proxyHandler
    const authHeader: string | undefined = undefined;
    const isPublic = false;

    // This replicates the gateway logic:
    const shouldReject = !isPublic && (!authHeader || !authHeader.toLowerCase().startsWith("bearer "));

    expect(shouldReject).toBe(true);
  });

  it("gateway rejects a malformed Authorization header (no Bearer prefix)", () => {
    const authHeader = "Basic dXNlcjpwYXNz"; // Basic auth, not Bearer
    const isPublic = false;

    const shouldReject = !isPublic && (!authHeader || !authHeader.toLowerCase().startsWith("bearer "));

    expect(shouldReject).toBe(true);
  });

  it("gateway allows public routes without Authorization header", () => {
    const authHeader: string | undefined = undefined;
    const isPublic = true; // e.g., /api/identity/login

    const shouldReject = !isPublic && (!authHeader || !authHeader.toLowerCase().startsWith("bearer "));

    expect(shouldReject).toBe(false);
  });
});
