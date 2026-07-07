/**
 * Tests for startup environment validation (Req 2.6).
 *
 * Validates that PII_ENC_KEY is required and must be at least 16 characters.
 * The service must fail to start if the key is missing or too short.
 */
import { describe, it, expect } from "vitest";
import { validatePiiEncKey } from "../src/shared/validate-env.js";

describe("validatePiiEncKey — startup validation (Req 2.6)", () => {
  it("returns error when PII_ENC_KEY is undefined", () => {
    const result = validatePiiEncKey(undefined);
    expect(result).not.toBeNull();
    expect(result).toContain("PII_ENC_KEY");
    expect(result).toContain("at least 16 characters");
  });

  it("returns error when PII_ENC_KEY is empty string", () => {
    const result = validatePiiEncKey("");
    expect(result).not.toBeNull();
    expect(result).toContain("PII_ENC_KEY");
  });

  it("returns error when PII_ENC_KEY is shorter than 16 characters", () => {
    const result = validatePiiEncKey("short-key");
    expect(result).not.toBeNull();
    expect(result).toContain("at least 16 characters");
  });

  it("returns error for exactly 15 characters", () => {
    const result = validatePiiEncKey("a".repeat(15));
    expect(result).not.toBeNull();
  });

  it("returns null (valid) for exactly 16 characters", () => {
    const result = validatePiiEncKey("a".repeat(16));
    expect(result).toBeNull();
  });

  it("returns null (valid) for key longer than 16 characters", () => {
    const result = validatePiiEncKey("test_pii_encryption_key_32chars!!");
    expect(result).toBeNull();
  });
});
