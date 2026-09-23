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
 *
 * Follow-up (CI Secret Scan): the ALLOW-LIST gate above was already correct,
 * but the dev/test convenience value itself was still a literal committed to
 * routes.ts, which .github/workflows/ci.yml's "Scan for known dev secrets in
 * source" job (grep-based, matches literal strings regardless of any gate
 * around them) kept failing on. resolveEmbedSecret() now reads that value
 * from ANALYTICS_EMBED_DEV_SECRET (documented in .env.example, which the scan
 * excludes) instead of returning a hardcoded literal, and refuses the request
 * — even in development/test — if neither JWT_SECRET nor
 * ANALYTICS_EMBED_DEV_SECRET is set. The tests below cover that: the two
 * "does NOT throw" cases now require ANALYTICS_EMBED_DEV_SECRET to be set,
 * there's a new case confirming dev/test without either var set now throws,
 * and a sabotage-check case confirming ANALYTICS_EMBED_DEV_SECRET can't leak
 * into a disallowed NODE_ENV even if it happens to be set there.
 */
import { describe, it, expect, afterEach } from "vitest";
import { resolveEmbedSecret } from "../src/modules/dashboards/routes.js";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_SECRET = process.env.JWT_SECRET;
const ORIGINAL_DEV_FALLBACK = process.env.ANALYTICS_EMBED_DEV_SECRET;

function restoreEnv(): void {
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_SECRET === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_DEV_FALLBACK === undefined) delete process.env.ANALYTICS_EMBED_DEV_SECRET;
  else process.env.ANALYTICS_EMBED_DEV_SECRET = ORIGINAL_DEV_FALLBACK;
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
      delete process.env.ANALYTICS_EMBED_DEV_SECRET;
      expect(() => resolveEmbedSecret()).toThrow(/JWT_SECRET is required/);
    },
  );

  // SABOTAGE CHECK: ANALYTICS_EMBED_DEV_SECRET is the dev/test-only fallback
  // value (see .env.example). It must never rescue a disallowed NODE_ENV —
  // if someone's environment accidentally carries it into staging/prod, the
  // endpoint must still fail closed exactly as if it were unset, not silently
  // sign with it.
  it.each(["staging", "production", "preprod", undefined])(
    "SABOTAGE CHECK: still throws with NODE_ENV=%s even when ANALYTICS_EMBED_DEV_SECRET is set (no JWT_SECRET)",
    (nodeEnv) => {
      if (nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = nodeEnv;
      delete process.env.JWT_SECRET;
      process.env.ANALYTICS_EMBED_DEV_SECRET = "sec-013-dev-fallback-test-value";
      expect(() => resolveEmbedSecret()).toThrow(/JWT_SECRET is required/);
      try {
        resolveEmbedSecret();
        expect.unreachable();
      } catch (err) {
        expect((err as { status?: number }).status).toBe(500);
        expect((err as { code?: string }).code).toBe("CONFIG_MISSING");
      }
    },
  );

  // The ONLY two environments allowed the convenience fallback — explicit
  // opt-in, not "anything that isn't literally production". The fallback
  // value itself must now come from ANALYTICS_EMBED_DEV_SECRET: there is no
  // in-code default left to fall back to (see SEC-013 CI Secret Scan
  // follow-up in the doc-comment above).
  it.each(["development", "test"])(
    "returns ANALYTICS_EMBED_DEV_SECRET with NODE_ENV=%s and no JWT_SECRET set (declared dev/test convenience)",
    (nodeEnv) => {
      process.env.NODE_ENV = nodeEnv;
      delete process.env.JWT_SECRET;
      process.env.ANALYTICS_EMBED_DEV_SECRET = "sec-013-dev-fallback-test-value";
      expect(resolveEmbedSecret()).toBe("sec-013-dev-fallback-test-value");
    },
  );

  // No hardcoded literal remains to fall back to: dev/test with BOTH vars
  // unset must now fail closed too, same as any other environment.
  it.each(["development", "test"])(
    "throws with NODE_ENV=%s when neither JWT_SECRET nor ANALYTICS_EMBED_DEV_SECRET is set (no silent fallback left)",
    (nodeEnv) => {
      process.env.NODE_ENV = nodeEnv;
      delete process.env.JWT_SECRET;
      delete process.env.ANALYTICS_EMBED_DEV_SECRET;
      expect(() => resolveEmbedSecret()).toThrow(/ANALYTICS_EMBED_DEV_SECRET/);
      try {
        resolveEmbedSecret();
        expect.unreachable();
      } catch (err) {
        expect((err as { status?: number }).status).toBe(500);
        expect((err as { code?: string }).code).toBe("CONFIG_MISSING");
      }
    },
  );

  it("an empty-string JWT_SECRET is treated as unset (still gated, not used as a literal empty secret)", () => {
    process.env.NODE_ENV = "development";
    process.env.JWT_SECRET = "";
    process.env.ANALYTICS_EMBED_DEV_SECRET = "sec-013-dev-fallback-test-value";
    expect(resolveEmbedSecret()).toBe("sec-013-dev-fallback-test-value");
  });

  it("an empty-string ANALYTICS_EMBED_DEV_SECRET is treated as unset too", () => {
    process.env.NODE_ENV = "development";
    delete process.env.JWT_SECRET;
    process.env.ANALYTICS_EMBED_DEV_SECRET = "";
    expect(() => resolveEmbedSecret()).toThrow(/ANALYTICS_EMBED_DEV_SECRET/);
  });
});
