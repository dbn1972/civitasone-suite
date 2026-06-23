import { describe, it, expect, beforeEach, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import { verifyJwt, signToken, toRequestContext, verifyToken, idempotentId } from "../src/index.js";

// ═══════════════════════════════════════════════════════════════════════════
// SEC-1 / SEC-2 acceptance tests (CTO remediation 08-security)
//
// Finding: a super_admin token forged with the public dev secret
// "civitasone-dev-secret" was accepted (HTTP 200) on the live system because
// HS256 shared-secret auth ran in production. These tests prove HS256 is now
// fail-closed in production and that tenant is derived from the token, not the
// attacker-controllable x-tenant-id header.
// ═══════════════════════════════════════════════════════════════════════════

const DEV_SECRET = "civitasone-dev-secret";

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
}

describe("SEC-1: HS256 shared-secret auth is forbidden in production", () => {
  beforeEach(resetEnv);
  afterEach(resetEnv);

  it("rejects a dev-secret-signed token in production (RS256 enforced)", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.JWT_ALGORITHM; // defaults to RS256
    process.env.JWT_SECRET = DEV_SECRET;

    const forged = jwt.sign(
      {
        sub: "attacker",
        tid: "00000000-0000-0000-0000-000000000001",
        roles: ["super_admin"],
      },
      DEV_SECRET,
      { algorithm: "HS256", expiresIn: "1h" },
    );

    // RS256 path tries to decode kid/JWKS — an HS256 token has no usable kid,
    // so verification must throw (never accept the forged token).
    await expect(verifyJwt(forged)).rejects.toThrow();
  });

  it("treats JWT_ALGORITHM=HS256 in production as a fatal misconfiguration", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_ALGORITHM = "HS256";
    process.env.JWT_SECRET = DEV_SECRET;

    const forged = jwt.sign({ sub: "attacker", roles: ["super_admin"] }, DEV_SECRET, {
      algorithm: "HS256",
    });

    await expect(verifyJwt(forged)).rejects.toThrow(/forbidden in production/i);
  });

  it("still allows HS256 in test/dev for local suites", async () => {
    process.env.NODE_ENV = "test";
    process.env.JWT_ALGORITHM = "HS256";
    process.env.JWT_SECRET = DEV_SECRET;

    const token = signToken(
      { sub: "u1", tid: "t1", roles: ["officer"], sid: "s1" },
      DEV_SECRET,
    );
    const payload = await verifyJwt(token);
    expect(payload.sub).toBe("u1");
  });
});

describe("SEC-2: tenant is derived from the token, not the x-tenant-id header", () => {
  beforeEach(resetEnv);
  afterEach(resetEnv);

  it("ignores the header tenant in production when token carries tid", () => {
    process.env.NODE_ENV = "production";
    const ctx = toRequestContext(
      { sub: "u1", tid: "tenant-from-token", roles: ["officer"], iat: 0, exp: 0 },
      "corr-1",
      "tenant-from-attacker-header",
    );
    expect(ctx.tenantId).toBe("tenant-from-token");
  });

  it("does NOT fall back to the header tenant in production", () => {
    process.env.NODE_ENV = "production";
    const ctx = toRequestContext(
      { sub: "u1", roles: ["officer"], iat: 0, exp: 0 },
      "corr-1",
      "tenant-from-attacker-header",
    );
    // No tid in token + production => header is ignored, tenant stays empty.
    expect(ctx.tenantId).toBe("");
  });

  it("allows header tenant fallback in dev/test only", () => {
    process.env.NODE_ENV = "test";
    const ctx = toRequestContext(
      { sub: "u1", roles: ["officer"], iat: 0, exp: 0 },
      "corr-1",
      "dev-tenant",
    );
    expect(ctx.tenantId).toBe("dev-tenant");
  });
});

describe("verifyToken HS256 helper rejects tampered tokens", () => {
  it("rejects a token signed with a different secret", () => {
    const token = signToken({ sub: "u1", roles: ["officer"] }, "secret-a");
    expect(() => verifyToken(token, "secret-b")).toThrow();
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// EVT-4 (04-T4): client idempotency — a double-submit with the same key must
// derive the same id (so it dedupes at the consumer), and distinct/absent keys
// must not collide.
// ═══════════════════════════════════════════════════════════════════════════
describe("idempotentId (EVT-4)", () => {
  it("derives a stable id from the same idempotency key", () => {
    const a = idempotentId({ idempotencyKey: "client-key-123" });
    const b = idempotentId({ idempotencyKey: "client-key-123" });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("derives different ids for different keys", () => {
    expect(idempotentId({ idempotencyKey: "key-a" })).not.toBe(idempotentId({ idempotencyKey: "key-b" }));
  });

  it("falls back to a random id when no key is provided", () => {
    expect(idempotentId({})).not.toBe(idempotentId({}));
  });
});
