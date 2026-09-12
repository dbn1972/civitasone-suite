/**
 * SEC-017 — ecosystem.config.js's IS_PROD must be an ALLOW-list
 * ({development, test} exempt from the fail-closed secret checks), not a
 * DENY-list (`=== "production"`, with unset defaulting to "production").
 *
 * Before this fix:
 *   const IS_PROD = (process.env.NODE_ENV ?? "production") === "production";
 * An UNSET NODE_ENV happened to be safe (the `?? "production"` default
 * covered it), but any OTHER value that wasn't the literal string
 * "production" -- "staging", "uat", "qa", "preprod", or a typo like
 * "productoin" -- made IS_PROD evaluate to false, silently taking the
 * dev-fallback path for every one of the 8 secrets this const gates
 * (DEVICE_TRUST_SECRET, JWT_SECRET, VISITOR_TENANT_SIGNING_KEY_PEM,
 * PII_ENC_KEY, ID_CARD_QR_SECRET, MFA_ENC_KEY, CITIZEN_PII_KEY, CRM_PII_KEY)
 * plus dbUrl()/scannerDbUrl()/piiKey(). Identical bug class to SEC-003's
 * resolveCandSecret() (services/hrms-service/.../candidate-public-auth-routes.ts).
 *
 * This spawns a real `node -e "require('ecosystem.config.js')"` subprocess
 * per scenario (module-level consts are evaluated once at require time and
 * memoized, so an in-process re-import within one vitest worker cannot
 * observe a second, differently-configured evaluation). Each scenario
 * supplies exactly the secrets evaluated BEFORE its target secret in the
 * file's top-to-bottom const order (see ecosystem.config.js) so the require
 * reaches -- and only fails on -- the secret under test.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const ECOSYSTEM_PATH = join(REPO_ROOT, "ecosystem.config.js");

// Representative "not actually production, but not declared dev/test either"
// values. Unset is NOT included here: it was already safe under the old
// `?? "production"` default and remains safe under the new allow-list —
// covered separately below as a non-regression case, not a regression case.
const FAILS_CLOSED_ENVS = ["staging", "uat", "qa", "preprod", "productoin"];
const ALLOWED_FALLBACK_ENVS = ["development", "test"];

function runRequire(nodeEnv: string | undefined, extraEnv: Record<string, string>, home: string) {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: home,
    ...extraEnv,
  };
  if (nodeEnv !== undefined) env.NODE_ENV = nodeEnv;
  try {
    execFileSync(process.execPath, ["-e", `require(${JSON.stringify(ECOSYSTEM_PATH)});`], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { threw: false, stderr: "" };
  } catch (err: any) {
    return { threw: true, stderr: String(err.stderr ?? "") };
  }
}

describe("SEC-017: ecosystem.config.js IS_PROD fail-closed by ALLOW-list, not deny-list", () => {
  // ── DEVICE_TRUST_SECRET — first secret gated by IS_PROD after
  // INTERNAL_SERVICE_SECRET (which is required unconditionally under IS_PROD,
  // so it must be supplied to get past it and reach DEVICE_TRUST_SECRET). ──
  describe.each(FAILS_CLOSED_ENVS)("NODE_ENV=%s", (nodeEnv) => {
    it("REGRESSION: refuses to require() with DEVICE_TRUST_SECRET unset (previously silently used the dev fallback)", () => {
      const home = mkdtempSync(join(tmpdir(), "sec017-"));
      try {
        const { threw, stderr } = runRequire(nodeEnv, { INTERNAL_SERVICE_SECRET: "a-real-internal-secret-value" }, home);
        expect(threw, `expected require() to throw; stderr:\n${stderr}`).toBe(true);
        expect(stderr).toMatch(/DEVICE_TRUST_SECRET is required in production/);
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    });

    it("REGRESSION: refuses to require() with VISITOR_TENANT_SIGNING_KEY_PEM unset (previously silently used the dev fallback)", () => {
      const home = mkdtempSync(join(tmpdir(), "sec017-"));
      try {
        const { threw, stderr } = runRequire(
          nodeEnv,
          {
            INTERNAL_SERVICE_SECRET: "a-real-internal-secret-value",
            DEVICE_TRUST_SECRET: "a-real-device-trust-secret-value",
          },
          home,
        );
        expect(threw, `expected require() to throw; stderr:\n${stderr}`).toBe(true);
        expect(stderr).toMatch(/VISITOR_TENANT_SIGNING_KEY_PEM is required in production/);
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    });

    it("REGRESSION: refuses to require() with PII_ENC_KEY unset and no host key file (previously silently used the dev fallback)", () => {
      // A fresh HOME with no ~/.civitasone-hrms-pii-key means PII_ENC_KEY's
      // env->host-key-file->dev-fallback resolver has nothing but the (now
      // fail-closed) dev fallback to reach for.
      const home = mkdtempSync(join(tmpdir(), "sec017-"));
      try {
        const { threw, stderr } = runRequire(
          nodeEnv,
          {
            INTERNAL_SERVICE_SECRET: "a-real-internal-secret-value",
            DEVICE_TRUST_SECRET: "a-real-device-trust-secret-value",
            VISITOR_TENANT_SIGNING_KEY_PEM: "a-real-visitor-signing-key-pem-value",
          },
          home,
        );
        expect(threw, `expected require() to throw; stderr:\n${stderr}`).toBe(true);
        expect(stderr).toMatch(/PII_ENC_KEY required for hrms-service/);
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    });
  });

  describe.each(ALLOWED_FALLBACK_ENVS)("NODE_ENV=%s (declared dev/test convenience, intentionally preserved)", (nodeEnv) => {
    it("does NOT throw and requires cleanly with NO secrets configured at all", () => {
      const home = mkdtempSync(join(tmpdir(), "sec017-"));
      try {
        const { threw, stderr } = runRequire(nodeEnv, {}, home);
        expect(threw, `expected require() to succeed; stderr:\n${stderr}`).toBe(false);
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    });
  });

  // Unset NODE_ENV was ALREADY fail-closed under the old `?? "production"`
  // default — confirms this fix did not regress that one case while fixing
  // every named non-production environment the old code missed.
  it("non-regression: NODE_ENV unset still refuses to require() with DEVICE_TRUST_SECRET unset (unchanged from before this fix)", () => {
    const home = mkdtempSync(join(tmpdir(), "sec017-"));
    try {
      const { threw, stderr } = runRequire(undefined, { INTERNAL_SERVICE_SECRET: "a-real-internal-secret-value" }, home);
      expect(threw, `expected require() to throw; stderr:\n${stderr}`).toBe(true);
      expect(stderr).toMatch(/DEVICE_TRUST_SECRET is required in production/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
