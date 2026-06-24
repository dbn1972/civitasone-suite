import { describe, it, expect } from "vitest";
import {
  isReservedKey, isValidKeyFormat, assertKeyAllowed, assertCanConfer,
  hasUnconditionalAuthority, DomainError,
} from "../src/modules/rbac/domain.js";
import { generateBase32Secret, totpCode, verifyTotpStep } from "../src/shared/mfa-crypto.js";

// ── C2: reserved / unbounded key creation ──────────────────────────────────
describe("SEC C2 — reserved + namespaced RBAC keys", () => {
  it("flags reserved/system keys", () => {
    for (const k of ["super_admin", "platform_admin", "tenant_admin", "system", "owner", "root", "service_account", "system.anything", "platform.x"]) {
      expect(isReservedKey(k)).toBe(true);
    }
    expect(isReservedKey("hr.employee.read")).toBe(false);
  });

  it("rejects keys outside the allowed namespace format", () => {
    expect(isValidKeyFormat("hr.employee.read")).toBe(true);
    expect(isValidKeyFormat("payroll:run")).toBe(true);
    expect(isValidKeyFormat("Bad Key")).toBe(false);
    expect(isValidKeyFormat("..x")).toBe(false);
    expect(isValidKeyFormat("UPPER")).toBe(false);
  });

  it("tenant_admin cannot create/confer a reserved key (403 → RESERVED_KEY)", () => {
    expect(() => assertKeyAllowed(["tenant_admin"], ["super_admin"]))
      .toThrowError(/reserved\/system key/);
    try {
      assertKeyAllowed(["tenant_admin"], ["tenant_admin"]);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("RESERVED_KEY");
    }
  });

  it("super_admin (unconditional authority) may mint reserved keys", () => {
    expect(() => assertKeyAllowed(["super_admin"], ["tenant_admin"])).not.toThrow();
    expect(hasUnconditionalAuthority(["super_admin"])).toBe(true);
    expect(hasUnconditionalAuthority(["tenant_admin"])).toBe(false);
  });
});

// ── C1: authority re-derivation (same predicate used at apply time) ─────────
describe("SEC C1 — apply-time authority predicate", () => {
  it("rejects conferring a permission the caller no longer holds", () => {
    // Simulate post-revocation: caller's effective perms no longer include the key.
    expect(() => assertCanConfer(["tenant_admin"], new Set<string>([]), ["payroll.run"]))
      .toThrowError(/cannot confer permissions you do not hold/);
  });
  it("allows when caller still holds the permission", () => {
    expect(() => assertCanConfer(["tenant_admin"], new Set(["payroll.run"]), ["payroll.run"])).not.toThrow();
  });
  it("unconditional authority bypasses the holding requirement", () => {
    expect(() => assertCanConfer(["super_admin"], new Set<string>([]), ["payroll.run"])).not.toThrow();
  });
});

// ── H1: TOTP single-use (step tracking) ─────────────────────────────────────
describe("SEC H1 — TOTP single-use step", () => {
  it("returns the matched step for a valid code and rejects replay-by-step", () => {
    const secret = generateBase32Secret();
    const now = Date.now();
    const code = totpCode(secret, { now });
    const step = verifyTotpStep(secret, code, { now });
    expect(step).not.toBeNull();
    // A consumer that records lastUsedStep = step must reject this same step again:
    const replayStep = verifyTotpStep(secret, code, { now });
    expect(replayStep).toBe(step); // same step → caller enforces step <= lastUsedStep
  });

  it("returns null for a wrong code", () => {
    const secret = generateBase32Secret();
    expect(verifyTotpStep(secret, "000000", { now: Date.now() })).toBeNull();
  });
});
