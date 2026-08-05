import { describe, it, expect } from "vitest";
import { maskPiiColumns, maskValue } from "./mask.js";

describe("maskPiiColumns", () => {
  const rows = [
    { name: "John Smith", email: "john@example.com", phone: "9876543210", age: 35 },
    { name: "Jane Doe", email: "jane@example.com", phone: "1234567890", age: 28 },
  ];
  const piiColumns = ["email", "phone"];

  it("masks PII columns for non-allowed roles", () => {
    const result = maskPiiColumns(rows, piiColumns, "employee", ["super_admin", "hr_admin"]);
    expect(result[0]!.email).toBe("jo***m");
    expect(result[0]!.phone).toBe("98***0");
    expect(result[1]!.email).toBe("ja***m");
    expect(result[1]!.phone).toBe("12***0");
  });

  it("leaves non-PII columns unchanged for non-allowed roles", () => {
    const result = maskPiiColumns(rows, piiColumns, "employee", ["super_admin"]);
    expect(result[0]!.name).toBe("John Smith");
    expect(result[0]!.age).toBe(35);
  });

  it("returns rows unchanged for allowed roles", () => {
    const result = maskPiiColumns(rows, piiColumns, "super_admin", ["super_admin", "hr_admin"]);
    expect(result[0]!.email).toBe("john@example.com");
    expect(result[0]!.phone).toBe("9876543210");
  });

  it("returns rows unchanged when piiColumns is empty", () => {
    const result = maskPiiColumns(rows, [], "employee", ["super_admin"]);
    expect(result[0]!.email).toBe("john@example.com");
  });

  it("handles empty rows array", () => {
    const result = maskPiiColumns([], piiColumns, "employee", ["super_admin"]);
    expect(result).toEqual([]);
  });

  it("handles rows with missing PII column keys gracefully", () => {
    const sparseRows = [{ name: "Test", age: 20 }];
    const result = maskPiiColumns(sparseRows, ["email"], "employee", ["admin"]);
    expect(result[0]!.name).toBe("Test");
    // email key not present in row — won't appear in output (Object.entries skips it)
    expect(result[0]!.email).toBeUndefined();
  });
});

describe("maskValue", () => {
  it("masks strings >= 4 chars with first 2 + *** + last char", () => {
    expect(maskValue("john@example.com")).toBe("jo***m");
    expect(maskValue("9876543210")).toBe("98***0");
    expect(maskValue("abcd")).toBe("ab***d");
  });

  it("fully masks short strings (< 4 chars)", () => {
    expect(maskValue("ab")).toBe("***");
    expect(maskValue("abc")).toBe("***");
    expect(maskValue("a")).toBe("***");
    expect(maskValue("")).toBe("***");
  });

  it("leaves null unchanged", () => {
    expect(maskValue(null)).toBeNull();
  });

  it("leaves undefined unchanged", () => {
    expect(maskValue(undefined)).toBeUndefined();
  });

  it("masks numbers as ***", () => {
    expect(maskValue(12345)).toBe("***");
    expect(maskValue(0)).toBe("***");
  });

  it("masks booleans as ***", () => {
    expect(maskValue(true)).toBe("***");
    expect(maskValue(false)).toBe("***");
  });

  it("masks objects as ***", () => {
    expect(maskValue({ nested: "value" })).toBe("***");
    expect(maskValue([1, 2, 3])).toBe("***");
  });
});
