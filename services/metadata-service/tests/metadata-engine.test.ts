/**
 * W2.1 — Metadata Engine tests.
 *
 * PROPERTY: A tenant admin defines a custom object + fields + validation rules,
 * and the engine validates records against them — no code, no migration.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateExpression,
  validateFieldValue,
  validateRecord,
  type FieldDef,
  type ValidationRule,
} from "../src/modules/rules/domain.js";

describe("W2.1 — Validation expression engine", () => {
  it("evaluates simple comparison: field > 0", () => {
    expect(evaluateExpression("amount > 0", { amount: 100 })).toBe(true);
    expect(evaluateExpression("amount > 0", { amount: 0 })).toBe(false);
    expect(evaluateExpression("amount > 0", { amount: -5 })).toBe(false);
  });

  it("evaluates equality", () => {
    expect(evaluateExpression('status == "active"', { status: "active" })).toBe(true);
    expect(evaluateExpression('status == "active"', { status: "draft" })).toBe(false);
  });

  it("evaluates AND", () => {
    expect(evaluateExpression("amount > 0 AND quantity > 0", { amount: 10, quantity: 5 })).toBe(true);
    expect(evaluateExpression("amount > 0 AND quantity > 0", { amount: 10, quantity: 0 })).toBe(false);
  });

  it("evaluates OR", () => {
    expect(evaluateExpression('type == "A" OR type == "B"', { type: "A" })).toBe(true);
    expect(evaluateExpression('type == "A" OR type == "B"', { type: "C" })).toBe(false);
  });

  it("evaluates NOT", () => {
    expect(evaluateExpression("NOT ISBLANK(name)", { name: "hello" })).toBe(true);
    expect(evaluateExpression("NOT ISBLANK(name)", { name: "" })).toBe(false);
  });

  it("evaluates ISBLANK function", () => {
    expect(evaluateExpression("ISBLANK(email)", { email: null })).toBe(true);
    expect(evaluateExpression("ISBLANK(email)", { email: "" })).toBe(true);
    expect(evaluateExpression("ISBLANK(email)", { email: "a@b.com" })).toBe(false);
  });

  it("evaluates LEN function", () => {
    expect(evaluateExpression("LEN(code) > 3", { code: "ABCD" })).toBe(true);
    expect(evaluateExpression("LEN(code) > 3", { code: "AB" })).toBe(false);
  });

  it("evaluates numeric inequality", () => {
    expect(evaluateExpression("price >= 100", { price: 100 })).toBe(true);
    expect(evaluateExpression("price >= 100", { price: 99 })).toBe(false);
    expect(evaluateExpression("price <= 1000", { price: 500 })).toBe(true);
  });

  it("handles null fields gracefully", () => {
    expect(evaluateExpression("amount > 0", { amount: null })).toBe(false);
    expect(evaluateExpression("ISBLANK(missing_field)", {})).toBe(true);
  });
});

describe("W2.1 — Field type validation", () => {
  it("required field rejects empty/null", () => {
    const field: FieldDef = { apiName: "name", fieldType: "text", isRequired: true };
    expect(validateFieldValue(null, field)).toContain("required");
    expect(validateFieldValue("", field)).toContain("required");
    expect(validateFieldValue("Alice", field)).toBeNull();
  });

  it("optional field accepts empty/null", () => {
    const field: FieldDef = { apiName: "notes", fieldType: "text", isRequired: false };
    expect(validateFieldValue(null, field)).toBeNull();
    expect(validateFieldValue("", field)).toBeNull();
  });

  it("number field rejects non-numeric", () => {
    const field: FieldDef = { apiName: "qty", fieldType: "number", isRequired: false };
    expect(validateFieldValue("abc", field)).toContain("must be a number");
    expect(validateFieldValue(42, field)).toBeNull();
  });

  it("picklist field rejects invalid values", () => {
    const field: FieldDef = { apiName: "status", fieldType: "picklist", isRequired: true, picklistValues: ["draft", "active", "closed"] };
    expect(validateFieldValue("draft", field)).toBeNull();
    expect(validateFieldValue("invalid", field)).toContain("must be one of");
  });

  it("date field validates format", () => {
    const field: FieldDef = { apiName: "dueDate", fieldType: "date", isRequired: false };
    expect(validateFieldValue("2024-06-15", field)).toBeNull();
    expect(validateFieldValue("not-a-date", field)).toContain("must be a valid date");
  });

  it("boolean field rejects non-boolean", () => {
    const field: FieldDef = { apiName: "isActive", fieldType: "boolean", isRequired: false };
    expect(validateFieldValue(true, field)).toBeNull();
    expect(validateFieldValue("yes", field)).toContain("must be a boolean");
  });
});

describe("W2.1 — Full record validation (fields + rules)", () => {
  const fields: FieldDef[] = [
    { apiName: "name", fieldType: "text", isRequired: true },
    { apiName: "amount", fieldType: "number", isRequired: true },
    { apiName: "status", fieldType: "picklist", isRequired: true, picklistValues: ["draft", "approved"] },
  ];

  const rules: ValidationRule[] = [
    { name: "amount_positive", expression: "amount > 0", errorMessage: "Amount must be positive", isActive: true },
    { name: "name_length", expression: "LEN(name) >= 3", errorMessage: "Name must be at least 3 characters", isActive: true },
    { name: "disabled_rule", expression: "amount < 0", errorMessage: "This should never fire", isActive: false },
  ];

  it("valid record passes all validations", () => {
    const data = { name: "Test Entity", amount: 500, status: "draft" };
    const errors = validateRecord(data, fields, rules);
    expect(errors).toHaveLength(0);
  });

  it("missing required field fails", () => {
    const data = { name: "Test", amount: 100 }; // missing status
    const errors = validateRecord(data, fields, rules);
    expect(errors.some((e) => e.includes("required"))).toBe(true);
  });

  it("negative amount fails rule", () => {
    const data = { name: "Test Entity", amount: -10, status: "draft" };
    const errors = validateRecord(data, fields, rules);
    expect(errors).toContain("Amount must be positive");
  });

  it("short name fails rule", () => {
    const data = { name: "AB", amount: 100, status: "draft" };
    const errors = validateRecord(data, fields, rules);
    expect(errors).toContain("Name must be at least 3 characters");
  });

  it("disabled rule does not fire", () => {
    const data = { name: "Test Entity", amount: -10, status: "draft" };
    const errors = validateRecord(data, fields, rules);
    expect(errors).not.toContain("This should never fire");
  });

  it("invalid picklist value fails", () => {
    const data = { name: "Test Entity", amount: 100, status: "invalid_status" };
    const errors = validateRecord(data, fields, rules);
    expect(errors.some((e) => e.includes("must be one of"))).toBe(true);
  });

  it("multiple errors collected at once", () => {
    const data = { name: "AB", amount: -5, status: "bad" };
    const errors = validateRecord(data, fields, rules);
    expect(errors.length).toBeGreaterThanOrEqual(3); // short name + negative amount + bad picklist
  });
});
