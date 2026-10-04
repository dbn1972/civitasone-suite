/**
 * Fail-closed sandbox/production detection for money paths (H3). Sandbox is an explicit allowlist; an unset, misspelt or
 * unexpected NODE_ENV is PRODUCTION.
 */
import { describe, it, expect } from "vitest";
import { isProductionDeployment, isSandboxDeployment, scannerConfigProblem } from "../src/shared/deployment-env.js";

const env = (o: Record<string, string | undefined>) => o as NodeJS.ProcessEnv;

describe("isSandboxDeployment / isProductionDeployment", () => {
  it("only development and test are sandbox by NODE_ENV", () => {
    expect(isSandboxDeployment(env({ NODE_ENV: "development" }))).toBe(true);
    expect(isSandboxDeployment(env({ NODE_ENV: "test" }))).toBe(true);
  });

  it("production, unset, empty, staging, prod and typos are all PRODUCTION (fail closed)", () => {
    for (const NODE_ENV of ["production", undefined, "", "staging", "prod", "Production", "dev", "uat"]) {
      expect(isProductionDeployment(env({ NODE_ENV })), String(NODE_ENV)).toBe(true);
    }
  });

  it("PFMS_SANDBOX=true is an explicit opt-in for a non-production environment with another NODE_ENV", () => {
    expect(isSandboxDeployment(env({ NODE_ENV: "staging", PFMS_SANDBOX: "true" }))).toBe(true);
    expect(isSandboxDeployment(env({ NODE_ENV: undefined, PFMS_SANDBOX: "true" }))).toBe(true);
    expect(isSandboxDeployment(env({ NODE_ENV: "staging", PFMS_SANDBOX: "1" }))).toBe(false);
    expect(isSandboxDeployment(env({ NODE_ENV: "staging", PFMS_SANDBOX: "false" }))).toBe(false);
  });

  it("PFMS_SANDBOX=true is REFUSED when NODE_ENV is production", () => {
    expect(isSandboxDeployment(env({ NODE_ENV: "production", PFMS_SANDBOX: "true" }))).toBe(false);
    expect(isProductionDeployment(env({ NODE_ENV: "production", PFMS_SANDBOX: "true" }))).toBe(true);
  });
});

describe("scannerConfigProblem (worker start-up)", () => {
  const prod = { NODE_ENV: "production", DATABASE_URL: "postgres://a" };
  it("names the exact variable to set when it is missing or equal to DATABASE_URL", () => {
    expect(scannerConfigProblem(env(prod))).toMatch(/FINANCE_SCANNER_DATABASE_URL is not set/);
    expect(scannerConfigProblem(env({ ...prod, FINANCE_SCANNER_DATABASE_URL: "postgres://a" }))).toMatch(/FINANCE_SCANNER_DATABASE_URL is identical to DATABASE_URL/);
    expect(scannerConfigProblem(env(prod))).toMatch(/finance_scanner/);
  });
  it("an unset or unexpected NODE_ENV is production here too, and the message says how to opt out", () => {
    const m = scannerConfigProblem(env({ DATABASE_URL: "postgres://a" }));
    expect(m).toMatch(/NODE_ENV=development/);
    expect(m).toMatch(/PFMS_SANDBOX=true/);
    expect(scannerConfigProblem(env({ NODE_ENV: "staging", DATABASE_URL: "postgres://a" }))).not.toBeNull();
  });
  it("is fine with a distinct scanner URL, and skipped in a sandbox", () => {
    expect(scannerConfigProblem(env({ ...prod, FINANCE_SCANNER_DATABASE_URL: "postgres://scanner" }))).toBeNull();
    expect(scannerConfigProblem(env({ NODE_ENV: "development" }))).toBeNull();
    expect(scannerConfigProblem(env({ NODE_ENV: "staging", PFMS_SANDBOX: "true" }))).toBeNull();
    expect(scannerConfigProblem(env({ NODE_ENV: "production", PFMS_SANDBOX: "true" }))).not.toBeNull();
  });
});
