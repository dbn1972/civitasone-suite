/**
 * payroll-critical fix — INTERNAL_SERVICE_SECRET needs the same dev/staging
 * fallback its DEVICE_TRUST_SECRET/JWT_SECRET siblings already have.
 *
 * Before this fix:
 *   const INTERNAL_SERVICE_SECRET = requireSecret("INTERNAL_SERVICE_SECRET");
 * requireSecret() only THROWS when unset under IS_PROD; outside production it
 * silently returned "" with no fallback -- unlike DEVICE_TRUST_SECRET and
 * JWT_SECRET two lines below it, which both do
 * `IS_PROD ? requireSecret(...) : (env ?? "<stable-dev-value>")`.
 *
 * Confirmed live on the shared PM2 fleet (via /proc/<pid>/environ): every
 * service -- payroll, payroll-worker, hrms, hrms-worker -- had
 * INTERNAL_SERVICE_SECRET="" in its actual process env, so hrms-service's
 * resolveServiceContextInner (packages/auth/src/context.ts) unconditionally
 * rejected the internal x-service-secret header with 401 (it fails closed on
 * an EMPTY configured secret before ever comparing the header -- see
 * packages/auth/tests/internal-secret.test.ts's own "rejects ... when the
 * server has no secret configured" case). That 401 surfaced as
 * `HrmsUnavailableError: hrms payroll-input failed: 401` on every payroll
 * run's async processing, not just under concurrent load.
 *
 * This spawns a real `node -e "require('ecosystem.config.js')"` subprocess
 * per scenario (module-level consts are evaluated once at require time and
 * memoized -- an in-process re-import within one vitest worker cannot
 * observe a second, differently-configured evaluation; see the identical
 * rationale in tests/security/sec-017-ecosystem-is-prod-allowlist.test.ts).
 * Each scenario prints the resolved apps[].env.INTERNAL_SERVICE_SECRET for
 * representative apps as JSON on stdout so the test can assert on the ACTUAL
 * VALUE, not just whether require() threw -- a bare "does it throw" check
 * would have passed even on the pre-fix code (silently resolving to ""
 * never threw).
 *
 * INTERNAL_SERVICE_SECRET is the FIRST secret this file's IS_PROD gate
 * checks (see requireSecret() call order in ecosystem.config.js), so unlike
 * sec-017's later-secret scenarios, no other secret needs to be supplied to
 * reach it under NODE_ENV=production.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const ECOSYSTEM_PATH = resolve(REPO_ROOT, "ecosystem.config.js");

type Secrets = { payrollWorker: string | null; hrmsWorker: string | null; payrollApi: string | null; hrmsApi: string | null };

function run(nodeEnv: string | undefined, extraEnv: Record<string, string> = {}): { threw: boolean; stderr: string; secrets: Secrets | null } {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", ...extraEnv };
  if (nodeEnv !== undefined) env.NODE_ENV = nodeEnv;
  const script = `
    const cfg = require(${JSON.stringify(ECOSYSTEM_PATH)});
    const byName = (n) => cfg.apps.find((a) => a.name === n);
    process.stdout.write(JSON.stringify({
      payrollWorker: byName("payroll-worker")?.env?.INTERNAL_SERVICE_SECRET ?? null,
      hrmsWorker: byName("hrms-worker")?.env?.INTERNAL_SERVICE_SECRET ?? null,
      payrollApi: byName("payroll")?.env?.INTERNAL_SERVICE_SECRET ?? null,
      hrmsApi: byName("hrms")?.env?.INTERNAL_SERVICE_SECRET ?? null,
    }));
  `;
  try {
    const stdout = execFileSync(process.execPath, ["-e", script], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { threw: false, stderr: "", secrets: JSON.parse(stdout) as Secrets };
  } catch (err: any) {
    return { threw: true, stderr: String(err.stderr ?? ""), secrets: null };
  }
}

describe("payroll-critical: INTERNAL_SERVICE_SECRET dev/staging fallback", () => {
  it.each(["development", "test"])(
    "REGRESSION (NODE_ENV=%s): resolves to a non-empty, matching secret for payroll-worker and hrms-worker when unset (previously both silently resolved to \"\")",
    (nodeEnv) => {
      const { threw, secrets } = run(nodeEnv, {});

      expect(threw).toBe(false);
      expect(secrets!.payrollWorker).not.toBe("");
      expect(secrets!.payrollWorker).not.toBeNull();
      expect(secrets!.hrmsWorker).not.toBe("");
      expect(secrets!.hrmsWorker).not.toBeNull();

      // The actual bug: payroll-worker's internal call to hrms-service only
      // succeeds if BOTH sides resolved to the SAME secret. Two
      // independently non-empty-but-different fallbacks would be just as
      // broken as two empty strings.
      expect(secrets!.payrollWorker).toBe(secrets!.hrmsWorker);
      expect(secrets!.payrollApi).toBe(secrets!.hrmsApi);
      expect(secrets!.payrollWorker).toBe(secrets!.payrollApi);
    },
  );

  it("REGRESSION: the resolved dev fallback matches the literal scripts/dev/start-stack.sh already uses, so a mixed PM2/bash-script dev environment agrees too", () => {
    const { secrets } = run("development", {});
    expect(secrets!.payrollWorker).toBe("civitasone-internal-dev-secret");
  });

  it("non-regression: an explicitly-injected INTERNAL_SERVICE_SECRET is still honored outside production (never silently overridden by the dev fallback)", () => {
    const { secrets } = run("development", { INTERNAL_SERVICE_SECRET: "an-explicitly-injected-secret" });
    expect(secrets!.payrollWorker).toBe("an-explicitly-injected-secret");
    expect(secrets!.hrmsWorker).toBe("an-explicitly-injected-secret");
  });

  it("non-regression: production posture is unchanged -- still refuses to require() with INTERNAL_SERVICE_SECRET unset (no insecure default introduced)", () => {
    const { threw, stderr } = run("production", {});
    expect(threw, `expected require() to throw; stderr:\n${stderr}`).toBe(true);
    expect(stderr).toMatch(/INTERNAL_SERVICE_SECRET is required in production/);
  });
});
