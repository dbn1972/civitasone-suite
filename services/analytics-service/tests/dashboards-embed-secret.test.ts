/**
 * SEC-013 — analytics-service dashboards embed token secret.
 *
 * `EMBED_SECRET = process.env.JWT_SECRET ?? "civitasone-dev-secret"`
 * (dashboards/routes.ts) was an unconditional hardcoded fallback used to sign
 * `/v1/analytics/dashboards/:id/embed` tokens. Reachable in every real
 * deployment: ecosystem.config.js deliberately leaves JWT_SECRET undefined in
 * production (RS256/Keycloak is the real auth path; JWT_SECRET only matters
 * for the HS256 dev/test convenience path — see packages/auth SEC-017), so a
 * real production analytics-service hit this fallback literal on every call.
 * Any authenticated analytics reader could mint an embed token signed with
 * this public, source-visible secret. The route has no real consumer today
 * (nothing verifies an embed token yet), so this was not independently
 * exploitable at the time of fixing, but the silent-insecure-default-in-
 * production pattern is exactly what this gap tracks. See
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md SEC-013.
 *
 * Fixed the same way SEC-003 fixed CANDIDATE_JWT_SECRET (resolveCandSecret,
 * hrms-service/src/modules/recruitment/candidate-public-auth-routes.ts) and
 * SEC-017 fixed isProduction() (packages/auth/src/index.ts): an ALLOW-LIST,
 * not a deny-list — only NODE_ENV === "development" or "test" get the
 * convenience fallback; every other value (unset, staging, uat, qa, a typo,
 * real production) must have JWT_SECRET configured, or the route refuses the
 * request (500 CONFIG_MISSING) instead of silently signing with the literal.
 *
 * Unlike resolveCandSecret/resolveQrSecret, resolveEmbedSecret is evaluated
 * per-request, not once at module load — JWT_SECRET is intentionally absent
 * in real production by design (ecosystem.config.js), so failing at
 * analytics-service *startup* would take down the whole service in the
 * normal, correctly-configured case. See the doc-comment above
 * resolveEmbedSecret in routes.ts for the full reasoning.
 */
import { describe, it, expect, afterEach } from "vitest";
import { resolveEmbedSecret } from "../src/modules/dashboards/routes.js";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_SECRET = process.env.JWT_SECRET;

function restoreEnv(): void {
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_SECRET === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = ORIGINAL_SECRET;
}

afterEach(() => {
  restoreEnv();
});

describe("SEC-013 — dashboards EMBED_SECRET fails closed by ALLOW-LIST", () => {
  it("throws 500 CONFIG_MISSING in production when JWT_SECRET is not set", () => {
    process.env.NODE_ENV = "production";
    delete process.env.JWT_SECRET;
    expect(() => resolveEmbedSecret()).toThrow(/JWT_SECRET is required/);
    try {
      resolveEmbedSecret();
      expect.unreachable();
    } catch (err) {
      expect((err as { status?: number }).status).toBe(500);
      expect((err as { code?: string }).code).toBe("CONFIG_MISSING");
    }
  });

  it("returns the configured secret in production once JWT_SECRET is set", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "sec-013-a-real-rotated-production-secret-value";
    expect(resolveEmbedSecret()).toBe("sec-013-a-real-rotated-production-secret-value");
  });

  // REGRESSION for the SEC-003/SEC-017 residual-gap pattern: a deny-list
  // (`NODE_ENV === "production"`) only denies the literal string
  // "production" — every other value (staging, UAT, QA, unset) previously
  // fell through to the hardcoded literal silently. Each of these must now
  // refuse instead.
  it.each(["staging", "uat", "qa", "preprod", "ci", undefined])(
    "REGRESSION: throws with NODE_ENV=%s and no JWT_SECRET set (previously silently accepted the hardcoded fallback)",
    (nodeEnv) => {
      if (nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = nodeEnv;
      delete process.env.JWT_SECRET;
      expect(() => resolveEmbedSecret()).toThrow(/JWT_SECRET is required/);
    },
  );

  // The ONLY two environments allowed the convenience fallback — explicit
  // opt-in, not "anything that isn't literally production".
  it.each(["development", "test"])(
    "does NOT throw with NODE_ENV=%s and no JWT_SECRET set (declared dev/test convenience, intentionally preserved)",
    (nodeEnv) => {
      process.env.NODE_ENV = nodeEnv;
      delete process.env.JWT_SECRET;
      expect(resolveEmbedSecret()).toBe("civitasone-dev-secret");
    },
  );

  it("an empty-string JWT_SECRET is treated as unset (still gated, not used as a literal empty secret)", () => {
    process.env.NODE_ENV = "development";
    process.env.JWT_SECRET = "";
    expect(resolveEmbedSecret()).toBe("civitasone-dev-secret");
  });
});
