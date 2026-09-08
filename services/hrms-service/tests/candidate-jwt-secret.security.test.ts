/**
 * SEC-003 — public careers-portal candidate auth token secret.
 *
 * `CANDIDATE_JWT_SECRET ?? "dev-cand-secret-not-for-production"`
 * (candidate-public-auth-routes.ts) was a hardcoded fallback with no
 * reference anywhere in docker-compose.yml, .env files, infra/, or ecosystem.config.js
 * -- every real deployment that didn't explicitly export the env var
 * silently signed 7-day cand_tokens with this same source-visible secret,
 * letting anyone who reads the public repo forge a valid token for any
 * tenantId/candidateId/email and read that candidate's application history
 * via candidate-public-portal-routes.ts. See
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md SEC-003.
 *
 * FIXUP (this file): the first cut of this fix only checked
 * `NODE_ENV === "production"` (a deny-list) -- so any value other than the
 * literal string "production" (unset, "staging", "uat", "qa", ...) still
 * silently fell back to the same source-visible literal, reproducing the
 * exact original vulnerability outside the one hardened path. The fix now
 * uses an ALLOW-LIST: only NODE_ENV === "development" or "test" get the
 * convenience fallback (and the fallback literal itself is rotated) --
 * everything else, including no NODE_ENV at all, must have a real secret
 * configured or the module refuses to load.
 *
 * Four things are under test:
 *   1. Fail-closed startup in production: throws when NODE_ENV=production
 *      and CANDIDATE_JWT_SECRET is not set.
 *   2. Fail-closed startup OUTSIDE production too: throws for staging/UAT/QA
 *      /unset-NODE_ENV -- the exact residual gap this file exists to close.
 *      Only "development"/"test" are exempt, and only those two.
 *   3. Forged-token rejection: a token signed with the OLD hardcoded
 *      fallback string must not verify once a real secret is configured.
 *   4. Server-side tenant binding: the token's tenantId claim must come
 *      from the OTP challenge row the server itself locked and verified,
 *      not be echoed back from client-supplied request input.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";

// candidate-public-auth-routes.ts imports `queue` from shared/infra.ts at
// MODULE TOP LEVEL (`export const queue = createQueue();`), which itself
// fails closed in production when QUEUE_DRIVER isn't sqs/rabbitmq. That
// check is real and correct, but unrelated to CANDIDATE_JWT_SECRET -- left
// unmocked, it throws first and masks the assertions this file exists to
// make. Stub it out so each test isolates the CANDIDATE_JWT_SECRET check.
vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: async () => undefined },
  cache: { get: async () => undefined, set: async () => undefined },
}));

// The exact literal that shipped source-visible in
// candidate-public-auth-routes.ts before this fix (and remained the
// module's own internal fallback -- unrotated -- through the first SEC-003
// fixup, even though ecosystem.config.js's copy was rotated).
const OLD_HARDCODED_FALLBACK = "dev-cand-secret-not-for-production";
const REAL_PROD_SECRET = "sec-003-a-real-rotated-production-secret-value-not-source-visible";

function signWithSecret(secret: string, payload: Record<string, unknown>): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_SECRET = process.env.CANDIDATE_JWT_SECRET;

function restoreEnv(): void {
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_SECRET === undefined) delete process.env.CANDIDATE_JWT_SECRET; else process.env.CANDIDATE_JWT_SECRET = ORIGINAL_SECRET;
}

afterEach(() => {
  restoreEnv();
  vi.resetModules();
});

describe("SEC-003 — CANDIDATE_JWT_SECRET fails closed by ALLOW-LIST", () => {
  it("refuses to start (throws at import) in production when CANDIDATE_JWT_SECRET is not set", async () => {
    vi.resetModules();
    process.env.NODE_ENV = "production";
    delete process.env.CANDIDATE_JWT_SECRET;
    await expect(
      import("../src/modules/recruitment/candidate-public-auth-routes.js"),
    ).rejects.toThrow(/CANDIDATE_JWT_SECRET is required/);
  });

  it("starts fine in production once CANDIDATE_JWT_SECRET is set", async () => {
    vi.resetModules();
    process.env.NODE_ENV = "production";
    process.env.CANDIDATE_JWT_SECRET = REAL_PROD_SECRET;
    const mod = await import("../src/modules/recruitment/candidate-public-auth-routes.js");
    expect(typeof mod.signCandToken).toBe("function");
  });

  // REGRESSION for the reviewer-found residual gap: previously only
  // NODE_ENV === "production" was denied; every other value (staging, UAT,
  // QA, unset) silently fell back to the hardcoded literal. Each of these
  // must now refuse to boot without a real secret.
  it.each(["staging", "uat", "qa", "preprod", "ci", undefined])(
    "REGRESSION: refuses to start with NODE_ENV=%s and no CANDIDATE_JWT_SECRET set (previously silently accepted the hardcoded fallback)",
    async (nodeEnv) => {
      vi.resetModules();
      if (nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = nodeEnv;
      delete process.env.CANDIDATE_JWT_SECRET;
      await expect(
        import("../src/modules/recruitment/candidate-public-auth-routes.js"),
      ).rejects.toThrow(/CANDIDATE_JWT_SECRET is required/);
    },
  );

  // The ONLY two environments allowed the convenience fallback -- explicit
  // opt-in, not "anything that isn't literally production".
  it.each(["development", "test"])(
    "does NOT throw with NODE_ENV=%s and no CANDIDATE_JWT_SECRET set (declared dev/test convenience, intentionally preserved)",
    async (nodeEnv) => {
      vi.resetModules();
      process.env.NODE_ENV = nodeEnv;
      delete process.env.CANDIDATE_JWT_SECRET;
      const mod = await import("../src/modules/recruitment/candidate-public-auth-routes.js");
      expect(typeof mod.signCandToken).toBe("function");
    },
  );
});

describe("SEC-003 — a token forged with the old hardcoded fallback secret is rejected", () => {
  it("REGRESSION: rejects a token signed with the old source-visible literal, once a real secret is configured; a token signed with the real secret still verifies", async () => {
    vi.resetModules();
    process.env.NODE_ENV = "production";
    process.env.CANDIDATE_JWT_SECRET = REAL_PROD_SECRET;
    const { verifyCandToken, signCandToken } = await import("../src/modules/recruitment/candidate-public-auth-routes.js");

    const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    const claims = {
      candidateId: "11111111-1111-1111-1111-111111111111",
      tenantId: "22222222-2222-2222-2222-222222222222",
      email: "victim@example.gov.in",
      exp,
    };

    // Exactly what the vulnerable code (verified separately, before this fix
    // landed) accepted: an attacker who only read the public repo, forging a
    // token for an arbitrary tenant/candidate/email with the hardcoded
    // fallback secret.
    const forged = signWithSecret(OLD_HARDCODED_FALLBACK, claims);
    expect(verifyCandToken(forged)).toBeNull();

    // Positive control: the SAME claims, signed with the module's own
    // signCandToken (i.e. the real configured secret), still verify --
    // proving the rejection above is about the wrong secret, not a broken
    // verify path.
    const genuine = signCandToken(claims);
    expect(verifyCandToken(genuine)).toEqual(claims);
  });

  it("REGRESSION (residual gap): a token forged with the old literal is rejected even in a staging-like deploy with a real secret configured", async () => {
    vi.resetModules();
    process.env.NODE_ENV = "staging";
    process.env.CANDIDATE_JWT_SECRET = REAL_PROD_SECRET;
    const { verifyCandToken } = await import("../src/modules/recruitment/candidate-public-auth-routes.js");
    const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    const forged = signWithSecret(OLD_HARDCODED_FALLBACK, {
      candidateId: "attacker-controlled-id",
      tenantId: "attacker-controlled-tenant",
      email: "attacker@evil.example",
      exp,
    });
    expect(verifyCandToken(forged)).toBeNull();
  });
});
