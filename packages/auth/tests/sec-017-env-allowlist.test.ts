import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";

// ═══════════════════════════════════════════════════════════════════════════
// SEC-017 — isProduction() must be an ALLOW-list ({development, test} are the
// only environments exempt from the strict/prod checks), not a DENY-list
// (`=== "production"`).
//
// Before this fix, packages/auth/src/index.ts's isProduction() returned
// `process.env.NODE_ENV === "production"`. Every service in this repo is
// launched with the NODE_ENV ecosystem.config.js injects as RUNTIME_NODE_ENV
// (default "production", but overridable — see docs/GOLDEN-PATH-AUDIT.md /
// docs/runbooks/launch-undeployed-services.md, which document exporting
// RUNTIME_NODE_ENV=staging). Any value that wasn't the exact literal string
// "production" -- unset, "staging", "uat", "qa", "preprod", or a typo like
// "productoin" -- made isProduction() evaluate to false, silently disabling
// BOTH strict checks it gates:
//   1. resolveAlgorithm(): JWT_ALGORITHM=HS256 (the public dev shared secret)
//      is normally forbidden outside dev/test.
//   2. verifyJwt(): an unset JWT_AUDIENCE/KEYCLOAK_CLIENT_ID is normally a
//      fatal misconfiguration outside dev/test (SAST-004, CWE-287).
//
// This file proves both are now fail-closed for every value except an
// explicitly-declared "development" or "test", and that "development"/"test"
// keep behaving exactly as before (no regression for CI/local suites).
// ═══════════════════════════════════════════════════════════════════════════

const DEV_SECRET = "civitasone-dev-secret";
const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
}

function setNodeEnv(value: string | undefined) {
  if (value === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = value;
}

// Representative "not actually production, but not declared dev/test either"
// values: unset, a sibling deploy-tier name, and a typo of the literal the
// old deny-list checked for.
const NON_PROD_NON_DEVTEST_ENVS: (string | undefined)[] = [
  undefined,
  "staging",
  "preprod",
  "uat",
  "qa",
  "productoin", // typo of "production"
];

describe("SEC-017: JWT_ALGORITHM=HS256 fail-closed by ALLOW-list, not deny-list", () => {
  beforeEach(resetEnv);
  afterEach(resetEnv);

  it.each(NON_PROD_NON_DEVTEST_ENVS)(
    "REGRESSION: rejects JWT_ALGORITHM=HS256 with NODE_ENV=%s (previously silently allowed — only NODE_ENV==='production' was denied)",
    async (nodeEnv) => {
      const { verifyJwt } = await import("../src/index.js");
      setNodeEnv(nodeEnv);
      process.env.JWT_ALGORITHM = "HS256";
      process.env.JWT_SECRET = DEV_SECRET;

      const forged = jwt.sign({ sub: "attacker", roles: ["super_admin"] }, DEV_SECRET, {
        algorithm: "HS256",
      });

      await expect(verifyJwt(forged)).rejects.toThrow(/forbidden in production/i);
    },
  );

  it.each(["development", "test"])(
    "does NOT throw with NODE_ENV=%s (declared dev/test convenience, intentionally preserved)",
    async (nodeEnv) => {
      const { verifyJwt, signToken } = await import("../src/index.js");
      process.env.NODE_ENV = nodeEnv;
      process.env.JWT_ALGORITHM = "HS256";
      process.env.JWT_SECRET = DEV_SECRET;

      const token = signToken(
        { sub: "u1", tid: "t1", roles: ["officer"], sid: "s1" },
        DEV_SECRET,
      );
      const payload = await verifyJwt(token);
      expect(payload.sub).toBe("u1");
    },
  );
});

describe("SEC-017: JWT_AUDIENCE requirement fail-closed by ALLOW-list, not deny-list", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const KID = "sec-017-test-kid";

  beforeEach(() => {
    resetEnv();
    vi.resetModules();
    // vitest.config.mjs's `test.env` sets JWT_ALGORITHM=HS256 repo-wide (so
    // per-service suites default to the no-Keycloak-needed path) — pin it
    // back to RS256 here so these tests exercise the RS256/audience path,
    // not the HS256 forbid-check from the describe block above.
    process.env.JWT_ALGORITHM = "RS256";
    // Avoid any real network call to a Keycloak JWKS endpoint: getSigningKey()
    // resolves the test key pair's public key regardless of kid. The fail-
    // closed audience check must throw BEFORE jwt.verify is ever reached, so
    // this fake key is never actually used to verify a signature in the
    // rejection cases below — only in the two positive (dev/test) cases,
    // where it verifies a token genuinely signed with the matching private key.
    vi.doMock("jwks-rsa", () => ({
      default: () => ({
        getSigningKey: (_kid: string, cb: (err: unknown, key: { getPublicKey(): string }) => void) => {
          cb(null, { getPublicKey: () => publicKey });
        },
      }),
    }));
  });
  afterEach(() => {
    resetEnv();
    vi.doUnmock("jwks-rsa");
    vi.resetModules();
  });

  function signRs256(claims: Record<string, unknown>) {
    // verifyJwt() validates iss against KEYCLOAK_URL/KEYCLOAK_REALM (both
    // defaulted here) — match it so the positive (dev/test) cases exercise
    // ONLY the audience-skip behavior, not an unrelated issuer mismatch.
    return jwt.sign(claims, privateKey, {
      algorithm: "RS256",
      keyid: KID,
      expiresIn: "1h",
      issuer: "http://civitasone-keycloak:8080/realms/civitasone",
    });
  }

  it.each(NON_PROD_NON_DEVTEST_ENVS)(
    "REGRESSION: rejects an RS256 token with no JWT_AUDIENCE/KEYCLOAK_CLIENT_ID when NODE_ENV=%s (previously silently skipped audience validation)",
    async (nodeEnv) => {
      setNodeEnv(nodeEnv);
      delete process.env.JWT_AUDIENCE;
      delete process.env.KEYCLOAK_CLIENT_ID;
      const { verifyJwt } = await import("../src/index.js");

      const token = signRs256({ sub: "u1", tid: "t1", roles: ["officer"] });
      await expect(verifyJwt(token)).rejects.toThrow(/JWT_AUDIENCE/);
    },
  );

  it.each(["development", "test"])(
    "still verifies successfully with no JWT_AUDIENCE set when NODE_ENV=%s (declared dev/test convenience, intentionally preserved)",
    async (nodeEnv) => {
      process.env.NODE_ENV = nodeEnv;
      delete process.env.JWT_AUDIENCE;
      delete process.env.KEYCLOAK_CLIENT_ID;
      const { verifyJwt } = await import("../src/index.js");

      const token = signRs256({ sub: "u1", tid: "t1", roles: ["officer"] });
      const payload = await verifyJwt(token);
      expect(payload.sub).toBe("u1");
    },
  );
});
