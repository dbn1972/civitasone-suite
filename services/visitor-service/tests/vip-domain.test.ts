/**
 * Feature: visitor-management, Task 17.1 — modules/vip/domain.ts
 *
 * Unit tests covering VIP privilege resolution branches (VIP vs non-VIP,
 * escort availability, fast-track/dedicated-parking flags) and the
 * VIP-log role-gating predicate/assertion.
 *
 * Requirements: 21.1, 21.4, 21.5
 */
import { describe, expect, it } from "vitest";
import {
  DomainError,
  VIP_LOG_ALLOWED_ROLES,
  assertCanViewVipLog,
  assignEscort,
  canViewVipLog,
  isVipCategory,
  resolveVipPrivileges,
  type DutyRosterEntry,
} from "../src/modules/vip/domain.js";

describe("isVipCategory", () => {
  it("returns true only for 'vip'", () => {
    expect(isVipCategory("vip")).toBe(true);
    expect(isVipCategory("standard")).toBe(false);
    expect(isVipCategory("contractor")).toBe(false);
    expect(isVipCategory("delegation")).toBe(false);
  });
});

describe("assignEscort", () => {
  it("returns null for an empty duty roster", () => {
    expect(assignEscort([])).toBeNull();
  });

  it("returns null when no roster entry is available", () => {
    const roster: DutyRosterEntry[] = [
      { employeeId: "e1", name: "Officer A", available: false },
      { employeeId: "e2", name: "Officer B", available: false },
    ];
    expect(assignEscort(roster)).toBeNull();
  });

  it("returns the first available entry's employeeId", () => {
    const roster: DutyRosterEntry[] = [
      { employeeId: "e1", name: "Officer A", available: false },
      { employeeId: "e2", name: "Officer B", available: true },
      { employeeId: "e3", name: "Officer C", available: true },
    ];
    expect(assignEscort(roster)).toBe("e2");
  });
});

describe("resolveVipPrivileges", () => {
  const availableRoster: DutyRosterEntry[] = [{ employeeId: "e1", name: "Officer A", available: true }];
  const unavailableRoster: DutyRosterEntry[] = [{ employeeId: "e1", name: "Officer A", available: false }];

  it("non-VIP category: no privileges at all, regardless of escortRequired or roster", () => {
    expect(resolveVipPrivileges("standard", true, availableRoster)).toEqual({
      dedicatedParking: false,
      fastTrack: false,
      escortEmployeeId: null,
    });
    expect(resolveVipPrivileges("contractor", true, availableRoster)).toEqual({
      dedicatedParking: false,
      fastTrack: false,
      escortEmployeeId: null,
    });
    expect(resolveVipPrivileges("delegation", false, availableRoster)).toEqual({
      dedicatedParking: false,
      fastTrack: false,
      escortEmployeeId: null,
    });
  });

  it("VIP category: dedicatedParking and fastTrack are always true", () => {
    const result = resolveVipPrivileges("vip", false, []);
    expect(result.dedicatedParking).toBe(true);
    expect(result.fastTrack).toBe(true);
  });

  it("VIP category with escortRequired=false: escortEmployeeId is null even with an available roster", () => {
    const result = resolveVipPrivileges("vip", false, availableRoster);
    expect(result.escortEmployeeId).toBeNull();
  });

  it("VIP category with escortRequired=true and an available officer: escort is assigned", () => {
    const result = resolveVipPrivileges("vip", true, availableRoster);
    expect(result.escortEmployeeId).toBe("e1");
  });

  it("VIP category with escortRequired=true but no available officer: escortEmployeeId is null", () => {
    const result = resolveVipPrivileges("vip", true, unavailableRoster);
    expect(result.escortEmployeeId).toBeNull();
  });

  it("VIP category with escortRequired=true and an empty roster: escortEmployeeId is null", () => {
    const result = resolveVipPrivileges("vip", true, []);
    expect(result.escortEmployeeId).toBeNull();
  });
});

describe("canViewVipLog / assertCanViewVipLog", () => {
  it("allows protocol_officer", () => {
    expect(canViewVipLog(["protocol_officer"])).toBe(true);
    expect(() => assertCanViewVipLog(["protocol_officer"])).not.toThrow();
  });

  it("allows security_admin", () => {
    expect(canViewVipLog(["security_admin"])).toBe(true);
    expect(() => assertCanViewVipLog(["security_admin"])).not.toThrow();
  });

  it("allows a user with multiple roles including one allowed role", () => {
    expect(canViewVipLog(["employee", "security_admin"])).toBe(true);
  });

  it("denies roles outside the allowed set", () => {
    expect(canViewVipLog(["employee"])).toBe(false);
    expect(canViewVipLog(["host"])).toBe(false);
    expect(canViewVipLog([])).toBe(false);
  });

  it("assertCanViewVipLog throws a DomainError with FORBIDDEN code for disallowed roles", () => {
    expect(() => assertCanViewVipLog(["employee"])).toThrow(DomainError);
    try {
      assertCanViewVipLog(["employee"]);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("FORBIDDEN");
    }
  });

  it("VIP_LOG_ALLOWED_ROLES matches the documented restricted role set", () => {
    expect(VIP_LOG_ALLOWED_ROLES).toEqual(["protocol_officer", "security_admin"]);
  });
});
