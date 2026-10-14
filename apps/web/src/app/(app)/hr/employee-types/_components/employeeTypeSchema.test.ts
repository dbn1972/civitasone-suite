import { describe, it, expect } from "vitest";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { validateEmployeeType } from "./employeeTypeSchema";

/** Every key a schema returns must exist in both locale bundles (hrFormErrors2). */
const expectKey = (key: string) => {
  expect((enMessages as unknown as Record<string, Record<string, string>>).hrFormErrors2[key], `en ${key}`).toBeTruthy();
  expect((hiMessages as unknown as Record<string, Record<string, string>>).hrFormErrors2[key], `hi ${key}`).toBeTruthy();
};

const ok = { code: "CONTRACT", name: "Contractual", description: "", defaultProbationMonths: 0, maxContractMonths: null as number | null };

describe("employeeTypeSchema schema", () => {
  it("accepts a valid body", () => {
    expect(validateEmployeeType(ok)).toEqual({});
  });
  it("blank code -> empTypeCodeRequired", () => {
    expect(validateEmployeeType({ ...ok, code: "  " }).code).toBe("empTypeCodeRequired");
    expectKey("empTypeCodeRequired");
  });
  it("code over 24 -> empTypeCodeMax", () => {
    expect(validateEmployeeType({ ...ok, code: "x".repeat(25) }).code).toBe("empTypeCodeMax");
    expectKey("empTypeCodeMax");
  });
  it("one-char name -> empTypeNameMin", () => {
    expect(validateEmployeeType({ ...ok, name: "a" }).name).toBe("empTypeNameMin");
    expectKey("empTypeNameMin");
  });
  it("name over 120 -> empTypeNameMax", () => {
    expect(validateEmployeeType({ ...ok, name: "n".repeat(121) }).name).toBe("empTypeNameMax");
    expectKey("empTypeNameMax");
  });
  it("description over 500 -> empTypeDescriptionMax", () => {
    expect(validateEmployeeType({ ...ok, description: "d".repeat(501) }).description).toBe("empTypeDescriptionMax");
    expectKey("empTypeDescriptionMax");
  });
  it("fractional probation -> empTypeProbationWhole", () => {
    expect(validateEmployeeType({ ...ok, defaultProbationMonths: 1.5 }).defaultProbationMonths).toBe("empTypeProbationWhole");
    expectKey("empTypeProbationWhole");
  });
  it("negative probation -> empTypeProbationNegative", () => {
    expect(validateEmployeeType({ ...ok, defaultProbationMonths: -1 }).defaultProbationMonths).toBe("empTypeProbationNegative");
    expectKey("empTypeProbationNegative");
  });
  it("zero contract months -> empTypeContractPositive", () => {
    expect(validateEmployeeType({ ...ok, maxContractMonths: 0 }).maxContractMonths).toBe("empTypeContractPositive");
    expectKey("empTypeContractPositive");
  });
});
