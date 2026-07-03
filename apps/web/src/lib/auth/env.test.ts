import { describe, it, expect, vi, beforeEach } from "vitest";
import { isDevLoginEnabled, defaultLoginPath } from "./env";

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
