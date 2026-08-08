/**
 * Identity Service — RBAC Domain: Deep tests.
 *
 * Tests authority model, reserved key protection, key format validation,
 * and anti-self-escalation conferral checks.
 *
 * Source: modules/rbac/domain.ts
 */
import { describe, it, expect } from "vitest";
import {
  hasUnconditionalAuthority, isReservedKey, isValidKeyFormat,
  assertKeyAllowed, assertCanConfer, DomainError,
} from "../src/modules/rbac/domain.js";

describe("hasUnconditionalAuthority", () => {
  it("true for super_admin", () => expect(hasUnconditionalAuthority(["super_admin"])).toBe(true));
  it("true for platform_admin", () => expect(hasUnconditionalAuthority(["platform_admin"])).toBe(true));
  it("true when one of multiple roles qualifies", () => expect(hasUnconditionalAuthority(["employee", "super_admin"])).toBe(true));
  it("false for tenant_admin", () => expect(hasUnconditionalAuthority(["tenant_admin"])).toBe(false));
  it("false for empty roles", () => expect(hasUnconditionalAuthority([])).toBe(false));
});

describe("isReservedKey", () => {
  it("super_admin is reserved", () => expect(isReservedKey("super_admin")).toBe(true));
  it("platform_admin is reserved", () => expect(isReservedKey("platform_admin")).toBe(true));
  it("tenant_admin is reserved", () => expect(isReservedKey("tenant_admin")).toBe(true));
  it("system is reserved", () => expect(isReservedKey("system")).toBe(true));
  it("root is reserved", () => expect(isReservedKey("root")).toBe(true));
  it("system.internal prefix is reserved", () => expect(isReservedKey("system.internal")).toBe(true));
  it("platform.ops prefix is reserved", () => expect(isReservedKey("platform.ops")).toBe(true));
  it("hr.employee.read is NOT reserved", () => expect(isReservedKey("hr.employee.read")).toBe(false));
  it("case-insensitive", () => expect(isReservedKey("SUPER_ADMIN")).toBe(true));
});

describe("isValidKeyFormat", () => {
  it("accepts simple key", () => expect(isValidKeyFormat("hr")).toBe(true));
  it("accepts dot-namespaced", () => expect(isValidKeyFormat("hr.employee.read")).toBe(true));
  it("accepts colon-namespaced", () => expect(isValidKeyFormat("payroll:run")).toBe(true));
  it("rejects uppercase", () => expect(isValidKeyFormat("HR.Employee")).toBe(false));
  it("rejects starting with number", () => expect(isValidKeyFormat("1invalid")).toBe(false));
  it("rejects spaces", () => expect(isValidKeyFormat("hr employee")).toBe(false));
  it("rejects empty", () => expect(isValidKeyFormat("")).toBe(false));
});

describe("assertKeyAllowed", () => {
  it("allows non-reserved key for any caller", () => {
    expect(() => assertKeyAllowed(["tenant_admin"], ["hr.employee.read"])).not.toThrow();
  });
  it("allows reserved key for super_admin", () => {
    expect(() => assertKeyAllowed(["super_admin"], ["system.internal"])).not.toThrow();
  });
  it("throws RESERVED_KEY for tenant_admin on reserved key", () => {
    expect(() => assertKeyAllowed(["tenant_admin"], ["super_admin"])).toThrow(DomainError);
  });
  it("throws INVALID_KEY for bad format", () => {
    expect(() => assertKeyAllowed(["super_admin"], ["BAD KEY!"])).toThrow(DomainError);
  });
});

describe("assertCanConfer — anti-self-escalation", () => {
  it("super_admin can confer anything", () => {
    expect(() => assertCanConfer(["super_admin"], new Set(), ["any.perm"])).not.toThrow();
  });
  it("caller with matching perms can confer", () => {
    expect(() => assertCanConfer(["hr_admin"], new Set(["hr.read", "hr.write"]), ["hr.read"])).not.toThrow();
  });
  it("throws SELF_ESCALATION when caller lacks required permission", () => {
    expect(() => assertCanConfer(["hr_admin"], new Set(["hr.read"]), ["hr.write"])).toThrow("SELF_ESCALATION");
  });
  it("throws when ANY required perm is missing", () => {
    expect(() => assertCanConfer(["hr_admin"], new Set(["hr.read"]), ["hr.read", "payroll.run"])).toThrow(DomainError);
  });
});
