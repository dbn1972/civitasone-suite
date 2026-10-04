/**
 * Fail-closed sandbox/production detection for money paths (H3). Sandbox is an explicit allowlist; an unset, misspelt or
 * unexpected NODE_ENV is PRODUCTION.
 */
import { describe, it, expect } from "vitest";
import { isProductionDeployment, isSandboxDeployment } from "../src/shared/deployment-env.js";

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
