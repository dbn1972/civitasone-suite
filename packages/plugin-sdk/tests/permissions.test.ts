import { describe, expect, it } from "vitest";
import {
  parsePermission,
  checkPermission,
  PERMISSION_CATALOG,
} from "../src/permissions.js";

describe("parsePermission", () => {
  it("parses a valid permission string", () => {
    const result = parsePermission("finance:invoice:read");
    expect(result).toEqual({
      service: "finance",
      resource: "invoice",
      action: "read",
    });
  });

  it("parses another valid permission", () => {
    const result = parsePermission("hrms:employee:write");
    expect(result).toEqual({
      service: "hrms",
      resource: "employee",
      action: "write",
    });
  });

  it("throws on too few segments", () => {
    expect(() => parsePermission("finance:invoice")).toThrow(
      /Invalid permission format/,
    );
  });

  it("throws on too many segments", () => {
    expect(() => parsePermission("a:b:c:d")).toThrow(
      /Invalid permission format/,
    );
  });

  it("throws on empty segments", () => {
    expect(() => parsePermission("::")).toThrow(/non-empty/);
  });
});

describe("checkPermission", () => {
  it("allows when all requested permissions are granted", () => {
    const result = checkPermission(
      ["finance:invoice:read", "hrms:employee:read"],
      ["finance:invoice:read", "hrms:employee:read", "hrms:employee:write"],
    );
    expect(result.allowed).toBe(true);
    expect(result.denied).toEqual([]);
  });

  it("denies when a requested permission is missing", () => {
    const result = checkPermission(
      ["finance:invoice:read", "finance:invoice:delete"],
      ["finance:invoice:read"],
    );
    expect(result.allowed).toBe(false);
    expect(result.denied).toEqual(["finance:invoice:delete"]);
  });

  it("supports action wildcard", () => {
    const result = checkPermission(
      ["finance:invoice:read", "finance:invoice:write"],
      ["finance:invoice:*"],
    );
    expect(result.allowed).toBe(true);
    expect(result.denied).toEqual([]);
  });

  it("supports resource wildcard", () => {
    const result = checkPermission(
      ["finance:invoice:read", "finance:budget:read"],
      ["finance:*:read"],
    );
    expect(result.allowed).toBe(true);
    expect(result.denied).toEqual([]);
  });

  it("supports full service wildcard", () => {
    const result = checkPermission(
      ["finance:invoice:read", "finance:budget:write"],
      ["finance:*:*"],
    );
    expect(result.allowed).toBe(true);
    expect(result.denied).toEqual([]);
  });

  it("returns all denied permissions", () => {
    const result = checkPermission(
      ["finance:invoice:read", "hrms:employee:delete", "asset:item:write"],
      ["finance:invoice:read"],
    );
    expect(result.allowed).toBe(false);
    expect(result.denied).toEqual([
      "hrms:employee:delete",
      "asset:item:write",
    ]);
  });

  it("handles empty requested list", () => {
    const result = checkPermission([], ["finance:invoice:read"]);
    expect(result.allowed).toBe(true);
    expect(result.denied).toEqual([]);
  });

  it("handles empty granted list", () => {
    const result = checkPermission(["finance:invoice:read"], []);
    expect(result.allowed).toBe(false);
    expect(result.denied).toEqual(["finance:invoice:read"]);
  });
});

describe("PERMISSION_CATALOG", () => {
  it("contains finance permissions", () => {
    expect(PERMISSION_CATALOG.finance).toBeDefined();
    expect(PERMISSION_CATALOG.finance.invoice).toContain("read");
  });

  it("contains hrms permissions", () => {
    expect(PERMISSION_CATALOG.hrms).toBeDefined();
    expect(PERMISSION_CATALOG.hrms.employee).toContain("write");
  });

  it("contains store permissions", () => {
    expect(PERMISSION_CATALOG.store).toBeDefined();
    expect(PERMISSION_CATALOG.store.data).toContain("delete");
  });
});
