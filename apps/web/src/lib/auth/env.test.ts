import { describe, it, expect, vi, beforeEach } from "vitest";
import { isDevLoginEnabled, defaultLoginPath, assertDevLoginConfig } from "./env";

describe("isDevLoginEnabled", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns false when ENABLE_DEV_LOGIN is not set", () => {
    vi.stubEnv("ENABLE_DEV_LOGIN", "");
    expect(isDevLoginEnabled()).toBe(false);
  });

  it("returns false when ENABLE_DEV_LOGIN is 'false'", () => {
    vi.stubEnv("ENABLE_DEV_LOGIN", "false");
    expect(isDevLoginEnabled()).toBe(false);
  });

  it("returns true when ENABLE_DEV_LOGIN is 'true'", () => {
    vi.stubEnv("ENABLE_DEV_LOGIN", "true");
    expect(isDevLoginEnabled()).toBe(true);
  });

  it("returns false for other values (security: opt-in only)", () => {
    vi.stubEnv("ENABLE_DEV_LOGIN", "1");
    expect(isDevLoginEnabled()).toBe(false);
  });
});

describe("defaultLoginPath", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns /auth/login in production (no dev login)", () => {
    vi.stubEnv("ENABLE_DEV_LOGIN", "");
    expect(defaultLoginPath()).toBe("/auth/login");
  });

  it("returns /auth/dev when dev login is enabled", () => {
    vi.stubEnv("ENABLE_DEV_LOGIN", "true");
    expect(defaultLoginPath()).toBe("/auth/dev");
  });
});

describe("assertDevLoginConfig (GAP-AUTH-DEV-01)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JWT_SECRET", "test_secret_for_civitasone_32chr"); // gitleaks:allow
    vi.stubEnv("DEV_LOGIN_PASSWORD", "pw"); // gitleaks:allow
    expect(() => assertDevLoginConfig()).toThrow(/production/);
  });

  it("throws when JWT_SECRET is missing", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("JWT_SECRET", "");
    vi.stubEnv("DEV_LOGIN_PASSWORD", "pw"); // gitleaks:allow
    expect(() => assertDevLoginConfig()).toThrow(/JWT_SECRET/);
  });

  it("throws when DEV_LOGIN_PASSWORD is empty", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("JWT_SECRET", "test_secret_for_civitasone_32chr"); // gitleaks:allow
    vi.stubEnv("DEV_LOGIN_PASSWORD", "");
    expect(() => assertDevLoginConfig()).toThrow(/DEV_LOGIN_PASSWORD/);
  });

  it("returns the validated secret and password when all invariants hold", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("JWT_SECRET", "test_secret_for_civitasone_32chr"); // gitleaks:allow
    vi.stubEnv("DEV_LOGIN_PASSWORD", "demo-pw-123"); // gitleaks:allow
    expect(assertDevLoginConfig()).toEqual({
      secret: "test_secret_for_civitasone_32chr", // gitleaks:allow
      password: "demo-pw-123", // gitleaks:allow
    });
  });
});
